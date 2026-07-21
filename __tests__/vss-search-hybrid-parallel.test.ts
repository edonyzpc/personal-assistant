import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { VSS } from '../src/vss';
import { type EmbeddingProfile, type VectorIndex, type VectorIndexStatus, type VectorSearchResult, type VSSChunk, type VSSFileRecord, type VSSFileState, type VSSIndexMarker, type VSSIndexStats } from '../src/vss/types';
import { MemoryVSSIndexStateStore } from '../src/vss/local-state-store';
import { getVSSDeviceId } from '../src/vss/state';
import { TFile } from 'obsidian';

// Holders that allow each test to configure the embed and rewrite delays without
// re-instantiating the AIUtils mock. embed delay: configurable per test; embed
// resolves to a fixed vector. createEmbeddings is async so embedQuery is reset
// each call.
const embedDelayHolder = { current: 0 };
const embedQueryCalls: { count: number; lastPrompt: string | null } = { count: 0, lastPrompt: null };

jest.mock('obsidian', () => {
    class MockTFile {
        path: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stat: any;
        extension: string;
        name: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(path: string, stat: any = {}, extension: string = 'md', name: string = path) {
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
            constructor(_message?: unknown) { /* noop */ }
        },
        normalizePath: (p: string) => p,
        Platform: { isMobile: false },
    };
});

jest.mock('../src/ai-services/service', () => {
    return {
        AIService: class {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
            constructor(..._args: any[]) { }
        },
    };
});

jest.mock('../src/ai-services/ai-utils', () => {
    return {
        AIUtils: class {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
            constructor(..._args: any[]) { }
            getDocumentContent(markdown: string) { return { content: markdown }; }
            cleanMarkdownContent(content: string) { return content; }
            async createEmbeddings() {
                return {
                    embedDocuments: async (texts: string[]) => texts.map(() => [0.1, 0.2]),
                    embedQuery: async (prompt: string) => {
                        embedQueryCalls.count++;
                        embedQueryCalls.lastPrompt = prompt;
                        if (embedDelayHolder.current > 0) {
                            await new Promise<void>(r => setTimeout(r, embedDelayHolder.current));
                        }
                        return [0.1, 0.2];
                    },
                };
            }
        },
    };
});

jest.mock('../src/vss/sqlite-vector-index', () => ({
    SqliteVectorIndex: jest.fn().mockImplementation(() => {
        const factory = (globalThis as { __mockSqliteVectorIndexFactory?: () => unknown }).__mockSqliteVectorIndexFactory;
        if (!factory) throw new Error('No mock SqliteVectorIndex factory configured');
        return factory();
    }),
}));

jest.mock('../src/confirm', () => ({
    confirmUserAction: jest.fn(async () => true),
}));

const buildFtsQueryMock = jest.fn((q: string) => `FTS:${q}`);
jest.mock('../src/vss/fts-query-builder', () => ({
    buildFtsQuery: (q: string) => buildFtsQueryMock(q),
}));

class FakeVectorIndex implements VectorIndex {
    status: VectorIndexStatus = 'ready';
    records = new Map<string, VSSFileRecord>();
    deleteFile = jest.fn<(path: string) => Promise<void>>(async (path) => {
        this.records.delete(path);
    });
    listFilePaths = jest.fn<() => Promise<string[]>>(async () => Array.from(this.records.keys()).sort());
    listFileRecords = jest.fn<() => Promise<VSSFileRecord[]>>(async () => Array.from(this.records.values()));
    upsertFile = jest.fn<(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]) => Promise<void>>(async () => undefined);
    updateFileMetadata = jest.fn<(fileState: VSSFileState) => Promise<void>>(async () => undefined);
    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => this.status);
    search = jest.fn<(queryEmbedding: number[], k: number) => Promise<VectorSearchResult[]>>(async () => []);
    getChunksByPath = jest.fn<VectorIndex["getChunksByPath"]>(async () => []);
    getFileRecord = jest.fn<(path: string) => Promise<VSSFileRecord | null>>(async () => null);
    getStats = jest.fn<() => Promise<VSSIndexStats>>(async () => ({
        status: this.status,
        backend: 'sqlite-wasm-opfs-sahpool',
        chunkCount: this.records.size,
        fileCount: this.records.size,
        fallbackMode: false,
    }));
    verify = jest.fn<() => Promise<VectorIndexStatus>>(async () => this.status);
    reset = jest.fn<() => Promise<void>>(async () => { this.records.clear(); });
    dispose = jest.fn<() => Promise<void>>(async () => undefined);
}

const createMissingFileError = (): NodeJS.ErrnoException => {
    const enoent = new Error('missing') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    return enoent;
};

const createPlugin = () => {
    const vssStateStore = new MemoryVSSIndexStateStore();
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin: any = {
        settings: {
            apiToken: 'token',
            vssCacheExcludePath: [],
            aiProvider: 'openai',
            embeddingModelName: 'model',
            baseURL: '',
            chatModelName: '',
            statisticsVaultId: 'vault-id',
        },
        manifest: { dir: '.obsidian/plugins/personal-assistant' },
        app: { vault: mockVault },
        join: (...parts: string[]) => parts.join('/'),
        getVSSFiles: jest.fn(() => []),
        createVSSIndexStateStore: jest.fn(() => vssStateStore),
        log: jest.fn(),
    };

    return { plugin };
};

function createReadyMarker(overrides: Partial<VSSIndexMarker> = {}): VSSIndexMarker {
    return {
        schemaVersion: 1,
        deviceId: getVSSDeviceId(),
        indexId: 'index-1',
        profileSignature: 'openai||model|1024|COSINE',
        backend: 'sqlite-wasm-opfs-sahpool',
        chunkCount: 1,
        fileCount: 1,
        builtAt: '2026-05-02T00:00:00.000Z',
        lastVerifiedAt: '2026-05-02T00:00:00.000Z',
        storagePersisted: true,
        ...overrides,
    };
}

function attachReadyIndex(vss: VSS, index: FakeVectorIndex): void {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (vss as any).initialized = true;
    (vss as any).deviceId = 'device-1';
    (vss as any).profile = {
        provider: 'openai',
        baseURL: '',
        model: 'model',
        dimensions: 1024,
        distanceMetric: 'COSINE',
    };
    (vss as any).index = index;
    (vss as any).status = 'ready';
    (vss as any).localStateReady = true;
    (vss as any).marker = createReadyMarker({ deviceId: 'device-1' });
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe('VSS searchHybrid parallel rewrite + embed', () => {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    beforeEach(() => {
        jest.useRealTimers();
        embedDelayHolder.current = 0;
        embedQueryCalls.count = 0;
        embedQueryCalls.lastPrompt = null;
        buildFtsQueryMock.mockClear();
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: jest.fn(() => 'device-1'),
                setItem: jest.fn(),
            },
        });
    });

    afterEach(() => {
        if (originalLocalStorage) {
            Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
        } else {
            delete (globalThis as { localStorage?: Storage }).localStorage;
        }
    });

    it('starts embedQuery before ftsQueryOverridePromise resolves', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());

        let resolveOverride: ((value: string) => void) | undefined;
        const ftsQueryOverridePromise = new Promise<string>((resolve) => {
            resolveOverride = resolve;
        });

        const searchPromise = vss.searchHybrid('raw prompt', { ftsQueryOverridePromise });
        for (let i = 0; i < 20 && embedQueryCalls.count === 0; i++) {
            await Promise.resolve();
        }

        expect(embedQueryCalls.count).toBe(1);
        expect(embedQueryCalls.lastPrompt).toBe('raw prompt');
        expect(buildFtsQueryMock).not.toHaveBeenCalled();

        resolveOverride?.('rewritten');
        await searchPromise;

        vss.dispose();
    });

    it('uses the rewritten override when the promise resolves with a string', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());

        const ftsQueryOverridePromise = Promise.resolve('rewritten-query');
        await vss.searchHybrid('raw prompt', { ftsQueryOverridePromise });

        expect(buildFtsQueryMock).toHaveBeenCalledWith('rewritten-query');
        expect(buildFtsQueryMock).not.toHaveBeenCalledWith('raw prompt');

        vss.dispose();
    });

    it('lets Pagelet admission wrap and immediately invoke embedQuery', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());
        const embedCallsObservedByAdmission: number[] = [];
        const executeEmbeddingInvoke = jest.fn(async (invoke: () => Promise<number[]>) => {
            embedCallsObservedByAdmission.push(embedQueryCalls.count);
            return invoke();
        });

        await vss.searchHybrid('raw prompt', { executeEmbeddingInvoke });

        expect(executeEmbeddingInvoke).toHaveBeenCalledTimes(1);
        expect(embedCallsObservedByAdmission).toEqual([0]);
        expect(embedQueryCalls.count).toBe(1);

        vss.dispose();
    });

    it('reuses an exact Pagelet query embedding while rerunning local search', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        const executeEmbeddingInvoke = jest.fn(async (invoke: () => Promise<number[]>) => invoke());

        await vss.searchHybrid('same semantic query', { executeEmbeddingInvoke });
        await vss.searchHybrid('same semantic query', { executeEmbeddingInvoke });

        expect(executeEmbeddingInvoke).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(1);
        expect(index.search).toHaveBeenCalledTimes(2);

        vss.dispose();
    });

    it('misses the Pagelet query cache when the embedding profile changes', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (vss as any).ensureIndex = jest.fn(async () => undefined);
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const executeEmbeddingInvoke = jest.fn(async (invoke: () => Promise<number[]>) => invoke());

        await vss.searchHybrid('same semantic query', { executeEmbeddingInvoke });
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (vss as any).profile = { ...(vss as any).profile, model: 'model-2' };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        await vss.searchHybrid('same semantic query', { executeEmbeddingInvoke });

        expect(executeEmbeddingInvoke).toHaveBeenCalledTimes(2);
        expect(embedQueryCalls.count).toBe(2);

        vss.dispose();
    });

    it('does not cache rejected or waiter-aborted Pagelet query attempts', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());
        const rejected = jest.fn(async (_invoke: () => Promise<number[]>) => {
            throw new Error('admission rejected');
        });

        await expect(vss.searchHybrid('retryable semantic query', {
            executeEmbeddingInvoke: rejected,
        })).rejects.toThrow('admission rejected');

        const retry = jest.fn(async (invoke: () => Promise<number[]>) => invoke());
        await vss.searchHybrid('retryable semantic query', { executeEmbeddingInvoke: retry });
        expect(rejected).toHaveBeenCalledTimes(1);
        expect(retry).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(1);

        const abortedController = new AbortController();
        const aborting = jest.fn(async (invoke: () => Promise<number[]>) => {
            const embedding = await invoke();
            abortedController.abort();
            return embedding;
        });
        await expect(vss.searchHybrid('aborted semantic query', {
            signal: abortedController.signal,
            executeEmbeddingInvoke: aborting,
        })).rejects.toThrow();

        const afterAbort = jest.fn(async (invoke: () => Promise<number[]>) => invoke());
        await vss.searchHybrid('aborted semantic query', { executeEmbeddingInvoke: afterAbort });
        expect(aborting).toHaveBeenCalledTimes(1);
        expect(afterAbort).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(3);

        vss.dispose();
    });

    it('deduplicates concurrent Pagelet query embedding calls', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());
        embedDelayHolder.current = 10;
        const executeEmbeddingInvoke = jest.fn(async (invoke: () => Promise<number[]>) => invoke());

        await Promise.all([
            vss.searchHybrid('concurrent semantic query', { executeEmbeddingInvoke }),
            vss.searchHybrid('concurrent semantic query', { executeEmbeddingInvoke }),
        ]);

        expect(executeEmbeddingInvoke).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(1);

        vss.dispose();
    });

    it('does not let the first waiter abort poison a concurrent current waiter', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        embedDelayHolder.current = 10;
        const firstController = new AbortController();
        let resolveOwnerStarted!: () => void;
        const ownerStarted = new Promise<void>((resolve) => {
            resolveOwnerStarted = resolve;
        });
        const firstAdmission = jest.fn(async (invoke: () => Promise<number[]>) => {
            const operation = invoke();
            firstController.abort();
            resolveOwnerStarted();
            return operation;
        });
        const secondAdmission = jest.fn(async (invoke: () => Promise<number[]>) => invoke());

        const first = vss.searchHybrid('shared semantic query', {
            signal: firstController.signal,
            executeEmbeddingInvoke: firstAdmission,
        });
        const firstOutcome = expect(first).rejects.toThrow();
        await ownerStarted;
        const second = vss.searchHybrid('shared semantic query', {
            executeEmbeddingInvoke: secondAdmission,
        });

        await firstOutcome;
        await expect(second).resolves.toEqual([]);

        expect(firstAdmission).toHaveBeenCalledTimes(1);
        expect(secondAdmission).not.toHaveBeenCalled();
        expect(embedQueryCalls.count).toBe(1);
        expect(index.search).toHaveBeenCalledTimes(1);

        const cachedAdmission = jest.fn(async (invoke: () => Promise<number[]>) => invoke());
        await vss.searchHybrid('shared semantic query', { executeEmbeddingInvoke: cachedAdmission });
        expect(cachedAdmission).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(2);

        vss.dispose();
    });

    it('does not call embedQuery when the Pagelet admission wrapper rejects', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());
        const executeEmbeddingInvoke = jest.fn(async (_invoke: () => Promise<number[]>) => {
            throw new Error('admission rejected');
        });

        await expect(vss.searchHybrid('raw prompt', { executeEmbeddingInvoke }))
            .rejects.toThrow('admission rejected');

        expect(executeEmbeddingInvoke).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(0);

        vss.dispose();
    });

    it('has no abort gate between a successful Pagelet admission and embedQuery', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());
        const controller = new AbortController();
        const executeEmbeddingInvoke = jest.fn(async (invoke: () => Promise<number[]>) => {
            controller.abort();
            return invoke();
        });

        await expect(vss.searchHybrid('raw prompt', {
            signal: controller.signal,
            executeEmbeddingInvoke,
        })).rejects.toThrow();

        expect(executeEmbeddingInvoke).toHaveBeenCalledTimes(1);
        expect(embedQueryCalls.count).toBe(1);

        vss.dispose();
    });

    it('falls back to raw prompt when the override promise rejects (no rethrow)', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());

        const ftsQueryOverridePromise = Promise.reject(new Error('rewrite blew up'));

        const result = await vss.searchHybrid('raw prompt', { ftsQueryOverridePromise });

        expect(buildFtsQueryMock).toHaveBeenCalledWith('raw prompt');
        // Did NOT call buildFtsQuery on a thrown value.
        expect(buildFtsQueryMock).not.toHaveBeenCalledWith(expect.any(Error));
        expect(result).toEqual([]);

        vss.dispose();
    });

    it('falls back to raw prompt when the override promise resolves null', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());

        const ftsQueryOverridePromise = Promise.resolve<string | null>(null);
        await vss.searchHybrid('raw prompt', { ftsQueryOverridePromise });

        expect(buildFtsQueryMock).toHaveBeenCalledWith('raw prompt');
        expect(buildFtsQueryMock).not.toHaveBeenCalledWith('rewritten-query');

        vss.dispose();
    });

    it('promise wins over legacy ftsQueryOverride when both are passed', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());

        const ftsQueryOverridePromise = Promise.resolve('from-promise');
        await vss.searchHybrid('raw prompt', {
            ftsQueryOverride: 'from-string',
            ftsQueryOverridePromise,
        });

        expect(buildFtsQueryMock).toHaveBeenCalledWith('from-promise');
        expect(buildFtsQueryMock).not.toHaveBeenCalledWith('from-string');

        vss.dispose();
    });

    it('treats override promise rejected with AbortError the same as any rejection (no leak, fallback applied)', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, new FakeVectorIndex());

        const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const ftsQueryOverridePromise = Promise.reject(abortError);

        // Override abort rejections are still treated as rewrite failures at
        // this layer; caller signals use the separate options.signal path.
        const result = await vss.searchHybrid('raw prompt', { ftsQueryOverridePromise });

        expect(buildFtsQueryMock).toHaveBeenCalledWith('raw prompt');
        expect(result).toEqual([]);

        vss.dispose();
    });

    it('handles override rejections before readiness early returns', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (vss as any).initialized = true;
        (vss as any).index = null;
        (vss as any).status = 'uninitialized';
        /* eslint-enable @typescript-eslint/no-explicit-any */

        const ftsQueryOverridePromise = Promise.reject(new Error('rewrite blew up early'));
        const executeEmbeddingInvoke = jest.fn(async (invoke: () => Promise<number[]>) => invoke());
        const result = await vss.searchHybrid('raw prompt', {
            ftsQueryOverridePromise,
            executeEmbeddingInvoke,
        });

        expect(result).toEqual([]);
        expect(buildFtsQueryMock).not.toHaveBeenCalled();
        expect(executeEmbeddingInvoke).not.toHaveBeenCalled();
        expect(embedQueryCalls.count).toBe(0);

        vss.dispose();
    });

    it('returns empty exact path chunks from fallback indexes without embedding', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        const result = await vss.getChunksByPath(['notes/a.md'], { limitPerPath: 2 });

        expect(result).toEqual([]);
        expect(index.getChunksByPath).toHaveBeenCalledWith(['notes/a.md'], {
            limitPerPath: 2,
            signal: undefined,
        });
        expect(embedQueryCalls.count).toBe(0);

        vss.dispose();
    });
});
