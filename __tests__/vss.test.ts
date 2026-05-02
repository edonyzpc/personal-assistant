import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { VSS } from '../src/vss';
import { DirtyTimestamps } from '../src/vss-helpers';
import { TFile } from 'obsidian';
import type { EmbeddingProfile, VectorIndex, VectorIndexStatus, VectorSearchResult, VSSChunk, VSSFileRecord, VSSFileState, VSSIndexStats } from '../src/vss/types';

const mockNoticeMessages: string[] = [];

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
        Notice: class {
            constructor(message?: unknown) {
                mockNoticeMessages.push(String(message));
            }
        },
        normalizePath: (p: string) => p,
    };
});

jest.mock('../src/ai-services/service', () => {
    return {
        AIService: class {
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
        }
    };
});

jest.mock('../src/ai-services/ai-utils', () => {
    return {
        AIUtils: class {
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
            getDocumentContent(markdown: string) { return { content: markdown }; }
            cleanMarkdownContent(content: string) { return content; }
            createEmbeddings = jest.fn(async () => ({
                embedDocuments: async (texts: string[]) => texts.map((_, index) => [index, 1]),
                embedQuery: async () => [1, 0],
            }));
        }
    };
});

jest.mock('../src/vss/sqlite-vector-index', () => ({
    SqliteVectorIndex: jest.fn().mockImplementation(() => {
        const factory = (globalThis as { __mockSqliteVectorIndexFactory?: () => unknown }).__mockSqliteVectorIndexFactory;
        if (!factory) throw new Error('No mock SqliteVectorIndex factory configured');
        return factory();
    }),
}));

const MockSqliteVectorIndex = (jest.requireMock('../src/vss/sqlite-vector-index') as { SqliteVectorIndex: jest.Mock }).SqliteVectorIndex;

class FakeVectorIndex implements VectorIndex {
    status: VectorIndexStatus = 'ready';
    records = new Map<string, VSSFileRecord>();
    deleteFile = jest.fn<(path: string) => Promise<void>>(async (path) => {
        this.records.delete(path);
    });
    listFilePaths = jest.fn<() => Promise<string[]>>(async () => Array.from(this.records.keys()).sort());
    upsertFile = jest.fn<(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]) => Promise<void>>(async (fileState) => {
        this.records.set(fileState.path, {
            path: fileState.path,
            contentHash: fileState.contentHash,
            mtime: fileState.mtime,
            size: fileState.size,
            status: 'ready',
            updatedAt: Date.now(),
        });
    });
    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => this.status);
    search = jest.fn<(queryEmbedding: number[], k: number) => Promise<VectorSearchResult[]>>(async () => []);
    getFileRecord = jest.fn<(path: string) => Promise<VSSFileRecord | null>>(async (path) => this.records.get(path) ?? null);
    getStats = jest.fn<() => Promise<VSSIndexStats>>(async () => ({
        status: this.status,
        backend: 'fake',
        chunkCount: this.records.size,
        fileCount: this.records.size,
        fallbackMode: false,
    }));
    verify = jest.fn<() => Promise<VectorIndexStatus>>(async () => this.status);
    reset = jest.fn<() => Promise<void>>(async () => {
        this.records.clear();
    });
    dispose = jest.fn<() => Promise<void>>(async () => undefined);
}

class FailingVectorIndex extends FakeVectorIndex {
    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => {
        throw new Error('opfs unavailable');
    });
}

const createMissingFileError = (): NodeJS.ErrnoException => {
    const enoent = new Error('missing') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    return enoent;
};

const createPlugin = (overrides: Record<string, unknown> = {}) => {
    const mockAdapter = {
        write: jest.fn<(path: string, data: string) => Promise<void>>(),
        read: jest.fn<(path: string) => Promise<string>>(async () => { throw createMissingFileError(); }),
        exists: jest.fn<(path: string) => Promise<boolean>>(async () => true),
        list: jest.fn<(path: string) => Promise<{ files: string[]; folders: string[] }>>(async () => ({ files: [], folders: [] })),
        remove: jest.fn<(path: string) => Promise<void>>(),
        mkdir: jest.fn<(path: string) => Promise<void>>(),
        getBasePath: jest.fn(() => '/vaults/Test Vault'),
        getResourcePath: jest.fn((path: string) => path),
    };

    const mockVault = {
        adapter: mockAdapter,
        getName: jest.fn(() => 'Test Vault'),
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
        manifest: { dir: '.obsidian/plugins/personal-assistant' },
        app: { vault: mockVault },
        join: (...parts: string[]) => parts.join('/'),
        getVSSFiles: jest.fn(() => []),
        log: jest.fn(),
        ...overrides,
    };

    return { plugin, mockAdapter, mockVault };
};

const setMockSqliteIndex = (index: VectorIndex): void => {
    (globalThis as { __mockSqliteVectorIndexFactory?: () => VectorIndex }).__mockSqliteVectorIndexFactory = () => index;
};

const clearMockSqliteIndex = (): void => {
    delete (globalThis as { __mockSqliteVectorIndexFactory?: () => VectorIndex }).__mockSqliteVectorIndexFactory;
};

const createTFile = (path: string, stat: any = {}, extension: string = 'md', name: string = path): TFile => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const FileCtor = TFile as unknown as { new(path: string, stat: any, extension?: string, name?: string): TFile }; // eslint-disable-line @typescript-eslint/no-explicit-any
    return new FileCtor(path, stat, extension, name);
};

function attachReadyIndex(vss: VSS, index: FakeVectorIndex): void {
    (vss as any).initialized = true; // eslint-disable-line @typescript-eslint/no-explicit-any
    (vss as any).deviceId = 'device-1'; // eslint-disable-line @typescript-eslint/no-explicit-any
    (vss as any).profile = { // eslint-disable-line @typescript-eslint/no-explicit-any
        provider: 'openai',
        baseURL: '',
        model: 'model',
        dimensions: 1024,
        distanceMetric: 'COSINE',
    };
    (vss as any).index = index; // eslint-disable-line @typescript-eslint/no-explicit-any
    (vss as any).status = 'ready'; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('VSS SQLite/WASM lifecycle', () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalConfirm = Object.getOwnPropertyDescriptor(globalThis, 'confirm');

    beforeEach(() => {
        jest.useFakeTimers();
        mockNoticeMessages.length = 0;
        clearMockSqliteIndex();
        MockSqliteVectorIndex.mockClear();
        Object.defineProperty(globalThis, 'confirm', {
            configurable: true,
            value: undefined,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        clearMockSqliteIndex();
        if (originalNavigator) {
            Object.defineProperty(globalThis, 'navigator', originalNavigator);
        } else {
            delete (globalThis as { navigator?: Navigator }).navigator;
        }
        if (originalConfirm) {
            Object.defineProperty(globalThis, 'confirm', originalConfirm);
        } else {
            delete (globalThis as { confirm?: (message?: string) => boolean }).confirm;
        }
    });

    it('does not load legacy JSON vectors into memory during initialization without a marker', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();

        expect(stats.status).toBe('uninitialized');
        expect(stats.chunkCount).toBe(0);
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
        vss.dispose();
    });

    it('uses a vault-scoped SQLite database and OPFS pool', async () => {
        const { plugin, mockAdapter, mockVault } = createPlugin();
        const index = new FakeVectorIndex();
        setMockSqliteIndex(index);
        mockVault.getName.mockReturnValue('Work Vault');
        mockAdapter.getBasePath.mockReturnValue('/vaults/Work Vault');
        const vss = new VSS(plugin, 'cache');

        await vss.rebuildLocalIndex({ silent: true });

        expect(MockSqliteVectorIndex).toHaveBeenCalledWith(expect.objectContaining({
            databaseName: expect.stringMatching(/^personal-assistant-vss-Work_20Vault-[a-z0-9]+\.sqlite3$/),
            opfsDirectory: expect.stringMatching(/^\/personal-assistant-vss-v2\/Work_20Vault-[a-z0-9]+$/),
            legacyOpfsDirectory: '/personal-assistant-vss',
            opfsVfsName: expect.stringMatching(/^opfs-sahpool-Work_20Vault-[a-z0-9]+$/),
            wasmUrl: expect.stringContaining('data:application/wasm'),
            workerFactory: expect.any(Function),
            workerUrl: 'inline:personal-assistant-vss-worker',
        }));
        vss.dispose();
    });

    it('separates same-name vaults by local vault path', async () => {
        const first = createPlugin();
        const second = createPlugin();
        setMockSqliteIndex(new FakeVectorIndex());
        first.mockVault.getName.mockReturnValue('Work Vault');
        second.mockVault.getName.mockReturnValue('Work Vault');
        first.mockAdapter.getBasePath.mockReturnValue('/vaults/personal/Work Vault');
        second.mockAdapter.getBasePath.mockReturnValue('/vaults/client/Work Vault');

        const firstVss = new VSS(first.plugin, 'cache');
        await firstVss.rebuildLocalIndex({ silent: true });
        const secondVss = new VSS(second.plugin, 'cache');
        await secondVss.rebuildLocalIndex({ silent: true });

        const firstOptions = MockSqliteVectorIndex.mock.calls[0][0] as { databaseName: string; opfsDirectory: string; opfsVfsName: string };
        const secondOptions = MockSqliteVectorIndex.mock.calls[1][0] as { databaseName: string; opfsDirectory: string; opfsVfsName: string };
        expect(firstOptions.databaseName).not.toBe(secondOptions.databaseName);
        expect(firstOptions.opfsDirectory).not.toBe(secondOptions.opfsDirectory);
        expect(firstOptions.opfsVfsName).not.toBe(secondOptions.opfsVfsName);
        firstVss.dispose();
        secondVss.dispose();
    });

    it('reuses one embeddings model while rebuilding multiple changed notes', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        const now = Date.now();
        const firstFile = createTFile('first.md', { size: 20, mtime: now, ctime: now }, 'md', 'first.md');
        const secondFile = createTFile('second.md', { size: 21, mtime: now + 1, ctime: now }, 'md', 'second.md');
        attachReadyIndex(vss, index);
        plugin.getVSSFiles.mockReturnValue([firstFile, secondFile]);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'first.md') return 'first memory note';
            if (path === 'second.md') return 'second memory note';
            throw createMissingFileError();
        });
        (vss as any).waitForEmbeddingRateGap = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.Mock; // eslint-disable-line @typescript-eslint/no-explicit-any

        await vss.rebuildLocalIndex({ silent: true });

        expect(createEmbeddings).toHaveBeenCalledTimes(1);
        expect(index.upsertFile).toHaveBeenCalledTimes(2);
        vss.dispose();
    });

    it('removes large files from the local index and dirty queue during manual flush', async () => {
        const baseTime = new Date('2025-01-01T00:00:00.000Z');
        jest.setSystemTime(baseTime);

        const { plugin, mockAdapter, mockVault } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        const largeFile = createTFile('large.md', { size: 2_000_000, mtime: Date.now(), ctime: Date.now() }, 'md', 'large.md');
        mockVault.getAbstractFileByPath.mockReturnValue(largeFile);

        const firstTs = Date.now() - 60_000;
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set(largeFile.path, { first: firstTs, last: firstTs });

        await vss.flush({ limit: 5, reason: 'test-large-file' });

        expect(dirtyMap.has(largeFile.path)).toBe(false);
        expect(index.deleteFile).toHaveBeenCalledWith('large.md');
        expect(mockAdapter.write).toHaveBeenCalledWith('cache/dirty.json', '{}');
    });

    it('removes indexed rows for files that disappeared before a force refresh', async () => {
        const { plugin, mockAdapter, mockVault } = createPlugin();
        const keepFile = createTFile('keep.md', { size: 4, mtime: Date.now(), ctime: Date.now() }, 'md', 'keep.md');
        plugin.getVSSFiles = jest.fn(() => [keepFile]);
        mockVault.getAbstractFileByPath.mockImplementation((path) => path === 'keep.md' ? keepFile : null);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'keep.md') return 'keep';
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('deleted.md', {
            path: 'deleted.md',
            contentHash: 'deleted-hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });

        await vss.flush({ force: true, reason: 'test-stale-delete' });

        expect(index.listFilePaths).toHaveBeenCalled();
        expect(index.deleteFile).toHaveBeenCalledWith('deleted.md');
        expect(index.records.has('deleted.md')).toBe(false);
        expect(index.upsertFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'keep.md' }), expect.any(Array), expect.any(Array));
    });

    it('removes stale index entries when cleaned markdown content is empty', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockResolvedValue('');
        const emptyFile = createTFile('empty.md', { size: 0, mtime: Date.now(), ctime: Date.now() }, 'md', 'empty.md');

        const status = await vss.refreshFileCache(emptyFile);

        expect(status).toBe('removed');
        expect(index.deleteFile).toHaveBeenCalledWith('empty.md');
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

    it('skips RAG search when VSS has never been initialized', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');

        const results = await vss.searchSimilarity('query');

        expect(results).toEqual([]);
    });

    it('maps first use to a rebuild memory plan', async () => {
        const note = createTFile('note.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'note.md');
        const { plugin } = createPlugin({
            getVSSFiles: jest.fn(() => [note]),
        });
        const vss = new VSS(plugin, 'cache');

        const plan = await vss.getMemoryReadiness();

        expect(plan).toMatchObject({
            reason: 'first-use',
            action: 'rebuild',
            notesToCheck: 1,
            notesLikelyToUpdate: 1,
            requiresApproval: true,
            canAnswerNow: true,
        });
    });

    it('maps dirty ready memory to a refresh memory plan', async () => {
        const note = createTFile('note.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'note.md');
        const { plugin } = createPlugin({
            getVSSFiles: jest.fn(() => [note]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set('note.md', { first: 1, last: 1 });

        const plan = await vss.getMemoryReadiness();

        expect(plan).toMatchObject({
            reason: 'changed-notes',
            action: 'refresh',
            notesToCheck: 1,
            notesLikelyToUpdate: 1,
            requiresApproval: true,
            canAnswerNow: true,
        });
    });

    it('maps ready memory to a no-op memory plan', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        const plan = await vss.getMemoryReadiness();

        expect(plan).toMatchObject({
            reason: 'ready',
            action: 'none',
            requiresApproval: false,
            canAnswerNow: true,
        });
    });

    it('maps local missing and settings changed states to rebuild memory plans', async () => {
        const { plugin } = createPlugin({
            getVSSFiles: jest.fn(() => [
                createTFile('one.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'one.md'),
                createTFile('two.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'two.md'),
            ]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        (vss as any).status = 'missing-local-index'; // eslint-disable-line @typescript-eslint/no-explicit-any
        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'local-memory-missing',
            action: 'rebuild',
            notesToCheck: 2,
            notesLikelyToUpdate: 2,
            requiresApproval: true,
        });

        (vss as any).status = 'stale'; // eslint-disable-line @typescript-eslint/no-explicit-any
        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'settings-changed',
            action: 'rebuild',
            notesToCheck: 2,
            notesLikelyToUpdate: 2,
            requiresApproval: true,
        });
    });

    it('marks profile mismatch as stale without rebuilding automatically', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const staleIndex = new FakeVectorIndex();
        staleIndex.status = 'stale';
        setMockSqliteIndex(staleIndex);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path.endsWith('/marker.json')) {
                return JSON.stringify({
                    schemaVersion: 1,
                    deviceId: 'device-1',
                    indexId: 'index-1',
                    profileSignature: 'openai||old-model|1024|COSINE',
                    backend: 'sqlite-wasm-opfs-sahpool',
                    chunkCount: 10,
                    fileCount: 4,
                    builtAt: '2026-05-02T00:00:00.000Z',
                    lastVerifiedAt: '2026-05-02T00:00:00.000Z',
                    storagePersisted: true,
                });
            }
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();

        expect(stats.status).toBe('stale');
        expect(staleIndex.reset).not.toHaveBeenCalled();
        expect(staleIndex.upsertFile).not.toHaveBeenCalled();
        expect(plugin.getVSSFiles).not.toHaveBeenCalled();
    });

    it('reopens the index and reports stale when embedding settings change in-session', async () => {
        const { plugin } = createPlugin();
        const oldIndex = new FakeVectorIndex();
        const staleIndex = new FakeVectorIndex();
        staleIndex.status = 'stale';
        setMockSqliteIndex(staleIndex);
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, oldIndex);

        plugin.settings.embeddingModelName = 'new-embedding-model';

        const results = await vss.searchSimilarity('query');
        const stats = await vss.getStats();

        expect(results).toEqual([]);
        expect(oldIndex.dispose).toHaveBeenCalled();
        expect(staleIndex.initialize).toHaveBeenCalledWith(expect.objectContaining({
            model: 'new-embedding-model',
        }));
        expect(stats.status).toBe('stale');
    });

    it('does not show a success notice when manual refresh aborts because memory is not ready', async () => {
        const { plugin } = createPlugin();
        const index = new FakeVectorIndex();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);
        (vss as any).status = 'stale'; // eslint-disable-line @typescript-eslint/no-explicit-any

        const summary = await vss.refreshLocalIndex();

        expect(summary.aborted).toBe(true);
        expect(index.listFilePaths).not.toHaveBeenCalled();
        expect(mockNoticeMessages).toEqual([
            'Memory is not ready. Prepare memory first.',
        ]);
    });

    it('reports missing-local-index when marker exists but local SQLite chunks are gone', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const emptyIndex = new FakeVectorIndex();
        emptyIndex.status = 'ready';
        setMockSqliteIndex(emptyIndex);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path.endsWith('/marker.json')) {
                return JSON.stringify({
                    schemaVersion: 1,
                    deviceId: 'device-1',
                    indexId: 'index-1',
                    profileSignature: 'openai||model|1024|COSINE',
                    backend: 'sqlite-wasm-opfs-sahpool',
                    chunkCount: 8,
                    fileCount: 3,
                    builtAt: '2026-05-02T00:00:00.000Z',
                    lastVerifiedAt: '2026-05-02T00:00:00.000Z',
                    storagePersisted: true,
                });
            }
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();
        const searchResults = await vss.searchSimilarity('query');

        expect(stats.status).toBe('missing-local-index');
        expect(stats.chunkCount).toBe(0);
        expect(searchResults).toEqual([]);
        expect(emptyIndex.reset).not.toHaveBeenCalled();
        expect(plugin.getVSSFiles).not.toHaveBeenCalled();
    });

    it('reuses the existing missing local backend during rebuild recovery', async () => {
        const { plugin } = createPlugin();
        const index = new FakeVectorIndex();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);
        (vss as any).status = 'missing-local-index'; // eslint-disable-line @typescript-eslint/no-explicit-any

        await vss.rebuildLocalIndex();
        const stats = await vss.getStats();

        expect(index.reset).toHaveBeenCalled();
        expect(stats.status).toBe('ready');
        expect(plugin.getVSSFiles).toHaveBeenCalled();
    });

    it('loads legacy JSON into Memory fallback when SQLite is unavailable and manifest is under both caps', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const failingIndex = new FailingVectorIndex();
        setMockSqliteIndex(failingIndex);
        const legacyJson = JSON.stringify([{
            content: 'legacy chunk',
            embedding: [1, 0],
            metadata: {
                path: 'note.md',
                chunkIndex: 0,
                contentHash: 'hash',
                created: 1,
                lastModified: 2,
            },
        }]);
        mockAdapter.list.mockImplementation(async (path) => {
            if (path === 'cache') {
                return { files: ['cache/note.md.json', 'cache/dirty.json'], folders: [] };
            }
            return { files: [], folders: [] };
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path.endsWith('/marker.json')) {
                return JSON.stringify({
                    schemaVersion: 1,
                    deviceId: 'device-1',
                    indexId: 'index-1',
                    profileSignature: 'openai||model|1024|COSINE',
                    backend: 'sqlite-wasm-opfs-sahpool',
                    chunkCount: 1,
                    fileCount: 1,
                    builtAt: '2026-05-02T00:00:00.000Z',
                    lastVerifiedAt: '2026-05-02T00:00:00.000Z',
                    storagePersisted: true,
                });
            }
            if (path.endsWith('/manifest.json')) {
                return JSON.stringify({
                    schemaVersion: 1,
                    deviceId: 'device-1',
                    profileSignature: 'openai||model|1024|COSINE',
                    fileCount: 1,
                    chunkCount: 1,
                    estimatedMemoryBytes: 4096,
                    legacyJsonCacheBytes: legacyJson.length,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                });
            }
            if (path === 'cache/note.md.json') return legacyJson;
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();
        const results = await vss.searchSimilarity('query');

        expect(failingIndex.dispose).toHaveBeenCalled();
        expect(stats.status).toBe('fallback');
        expect(stats.fallbackMode).toBe(true);
        expect(stats.chunkCount).toBe(1);
        expect(results[0].doc.pageContent).toBe('legacy chunk');
    });

    it('disables VSS without scanning legacy JSON when SQLite is unavailable and no manifest exists', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const failingIndex = new FailingVectorIndex();
        setMockSqliteIndex(failingIndex);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path.endsWith('/marker.json')) {
                return JSON.stringify({
                    schemaVersion: 1,
                    deviceId: 'device-1',
                    indexId: 'index-1',
                    profileSignature: 'openai||model|1024|COSINE',
                    backend: 'sqlite-wasm-opfs-sahpool',
                    chunkCount: 1,
                    fileCount: 1,
                    builtAt: '2026-05-02T00:00:00.000Z',
                    lastVerifiedAt: '2026-05-02T00:00:00.000Z',
                    storagePersisted: true,
                });
            }
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();
        const results = await vss.searchSimilarity('query');

        expect(stats.status).toBe('disabled');
        expect(results).toEqual([]);
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
    });

    it('surfaces SQLite initialization failures during manual rebuild', async () => {
        const { plugin } = createPlugin();
        const failingIndex = new FailingVectorIndex();
        setMockSqliteIndex(failingIndex);
        const vss = new VSS(plugin, 'cache');

        await expect(vss.rebuildLocalIndex({ silent: true })).rejects.toThrow('opfs unavailable');

        expect(failingIndex.dispose).toHaveBeenCalled();
        expect(plugin.log).toHaveBeenCalledWith('SQLite VSS index unavailable', expect.any(Error));
        vss.dispose();
    });

    it('continues rebuild in best-effort storage when persistent storage is denied', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const index = new FakeVectorIndex();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                storage: {
                    persisted: jest.fn(async () => false),
                    persist: jest.fn(async () => false),
                    estimate: jest.fn(async () => ({ usage: 4096, quota: 8192 })),
                },
            },
        });
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await vss.rebuildLocalIndex();
        const stats = await vss.getStats();

        expect(index.reset).toHaveBeenCalled();
        expect(stats.storagePersisted).toBe(false);
        expect(stats.storageUsage).toBe(4096);
        expect(stats.storageQuota).toBe(8192);
        expect(mockAdapter.write).toHaveBeenCalledWith(expect.stringContaining('/marker.json'), expect.stringContaining('"storagePersisted": false'));
    });

    it('resets the local index, removes device state files, and releases the active backend', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const index = new FakeVectorIndex();
        index.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await vss.resetLocalIndex();
        const stats = await vss.getStats();

        expect(index.reset).toHaveBeenCalled();
        expect(index.dispose).toHaveBeenCalled();
        expect(mockAdapter.remove).toHaveBeenCalledWith(expect.stringContaining('/marker.json'));
        expect(mockAdapter.remove).toHaveBeenCalledWith(expect.stringContaining('/manifest.json'));
        expect(stats.status).toBe('uninitialized');
        expect(stats.chunkCount).toBe(0);
    });

    it('cleans only legacy VSS JSON files after ready marker and explicit confirmation', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const index = new FakeVectorIndex();
        index.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });
        mockAdapter.list.mockImplementation(async (path) => {
            if (path === 'cache') {
                return {
                    files: ['cache/note.md.json', 'cache/dirty.json', 'cache/other.md.json'],
                    folders: [],
                };
            }
            return { files: [], folders: [] };
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path.endsWith('/marker.json')) {
                return JSON.stringify({
                    schemaVersion: 1,
                    deviceId: 'device-1',
                    indexId: 'index-1',
                    profileSignature: 'openai||model|1024|COSINE',
                    backend: 'sqlite-wasm-opfs-sahpool',
                    chunkCount: 1,
                    fileCount: 1,
                    builtAt: '2026-05-02T00:00:00.000Z',
                    lastVerifiedAt: '2026-05-02T00:00:00.000Z',
                    storagePersisted: true,
                });
            }
            if (path === 'cache/note.md.json') return '12345';
            if (path === 'cache/other.md.json') return '1234567';
            throw createMissingFileError();
        });
        const confirm = jest.fn<(message?: string) => boolean>(() => true);
        Object.defineProperty(globalThis, 'confirm', {
            configurable: true,
            value: confirm,
        });
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await vss.cleanLegacyJsonCache();

        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete 2 old memory cache files'));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Notes will not be deleted'));
        expect(mockAdapter.remove).toHaveBeenCalledWith('cache/note.md.json');
        expect(mockAdapter.remove).toHaveBeenCalledWith('cache/other.md.json');
        expect(mockAdapter.remove).not.toHaveBeenCalledWith('cache/dirty.json');
    });

    it('does not clean legacy JSON when SQLite stats are not safely ready', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const index = new FakeVectorIndex();
        const confirm = jest.fn<(message?: string) => boolean>(() => true);
        Object.defineProperty(globalThis, 'confirm', {
            configurable: true,
            value: confirm,
        });
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await vss.cleanLegacyJsonCache();

        expect(confirm).not.toHaveBeenCalled();
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
        expect(mockAdapter.remove).not.toHaveBeenCalled();
    });
});
