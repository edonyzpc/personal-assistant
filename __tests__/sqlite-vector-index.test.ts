import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { SqliteVectorIndex } from '../src/vss/sqlite-vector-index';
import type { SqliteWorkerRequest, SqliteWorkerResponse } from '../src/vss/sqlite-worker-protocol';
import type { VSSIndexStats } from '../src/vss/types';

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const readyStats: VSSIndexStats = {
    status: 'ready',
    backend: 'mock-worker',
    chunkCount: 0,
    fileCount: 0,
    fallbackMode: false,
};

class MockWorker {
    onmessage: ((event: MessageEvent<SqliteWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminate = jest.fn();
    postMessage = jest.fn((request: SqliteWorkerRequest) => {
        if (!this.respond) return;
        queueMicrotask(() => {
            this.onmessage?.({
                data: {
                    id: request.id,
                    ok: true,
                    result: this.result,
                },
            } as MessageEvent<SqliteWorkerResponse>);
        });
    });

    constructor(
        private readonly respond = false,
        private readonly result: unknown = readyStats,
    ) { }

    fail(message: string): void {
        this.onerror?.({
            message,
            filename: 'vss-sqlite-worker.js',
            lineno: 12,
            colno: 3,
        } as ErrorEvent);
    }
}

async function waitForPostMessage(worker: MockWorker): Promise<void> {
    for (let i = 0; i < 10; i++) {
        if (worker.postMessage.mock.calls.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Worker postMessage was not called.');
}

describe('SqliteVectorIndex worker recovery', () => {
    afterEach(() => {
        if (originalWorker) {
            Object.defineProperty(globalThis, 'Worker', originalWorker);
        } else {
            delete (globalThis as { Worker?: unknown }).Worker;
        }
        if (originalFetch) {
            Object.defineProperty(globalThis, 'fetch', originalFetch);
        } else {
            delete (globalThis as { fetch?: unknown }).fetch;
        }
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('terminates and recreates the worker after a fatal worker error', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const firstWorker = new MockWorker(false);
        const secondWorker = new MockWorker(true);
        const workerQueue = [firstWorker, secondWorker];
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => workerQueue.shift() as unknown as Worker,
        });

        const failedStats = index.getStats();
        await waitForPostMessage(firstWorker);
        firstWorker.fail('sqlite worker oom');

        await expect(failedStats).rejects.toThrow('sqlite worker oom');
        const recoveredStats = await index.getStats();

        expect(recoveredStats.backend).toBe('mock-worker');
        expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
        expect(secondWorker.postMessage).toHaveBeenCalledTimes(1);
        expect(workerQueue).toHaveLength(0);
    });

    it('passes scoped OPFS options to worker initialization', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(true, 'ready');
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            databaseName: 'personal-assistant-vss-work.sqlite3',
            opfsDirectory: '/personal-assistant-vss-v2/work-scope',
            legacyOpfsDirectory: '/personal-assistant-vss',
            opfsVfsName: 'opfs-sahpool-work-scope',
            workerFactory: () => worker as unknown as Worker,
        });

        const status = await index.initialize({
            provider: 'openai',
            baseURL: '',
            model: 'model',
            dimensions: 1024,
            distanceMetric: 'COSINE',
        });

        expect(status).toBe('ready');
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'initialize',
            payload: expect.objectContaining({
                databaseName: 'personal-assistant-vss-work.sqlite3',
                opfsDirectory: '/personal-assistant-vss-v2/work-scope',
                legacyOpfsDirectory: '/personal-assistant-vss',
                opfsVfsName: 'opfs-sahpool-work-scope',
            }),
        }));
    });

    it('decodes inline WASM data URLs without fetch', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const fetchMock = jest.fn(() => {
            throw new Error('fetch should not be used for inline wasm');
        });
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetchMock,
        });
        URL.createObjectURL = jest.fn(() => 'blob:sqlite-wasm');
        URL.revokeObjectURL = jest.fn();
        const worker = new MockWorker(true, 'ready');
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            wasmUrl: 'data:application/wasm;base64,AQID',
            workerFactory: () => worker as unknown as Worker,
        });

        await expect(index.initialize({
            provider: 'openai',
            baseURL: '',
            model: 'model',
            dimensions: 1024,
            distanceMetric: 'COSINE',
        })).resolves.toBe('ready');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'initialize',
            payload: expect.objectContaining({
                wasmUrl: 'blob:sqlite-wasm',
            }),
        }));
    });

    it('passes inline WASM blob URLs directly to the worker', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        URL.createObjectURL = jest.fn(() => 'blob:unexpected-wrap');
        const worker = new MockWorker(true, 'ready');
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            wasmUrl: 'blob:sqlite-wasm',
            workerFactory: () => worker as unknown as Worker,
        });

        await expect(index.initialize({
            provider: 'openai',
            baseURL: '',
            model: 'model',
            dimensions: 1024,
            distanceMetric: 'COSINE',
        })).resolves.toBe('ready');

        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'initialize',
            payload: expect.objectContaining({
                wasmUrl: 'blob:sqlite-wasm',
            }),
        }));
    });

    it('sends searchHybrid with correct payload and returns fused results', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const hybridResults = [
            { score: 0.032, distance: 0, doc: { pageContent: 'chunk1', metadata: { path: 'a.md', chunkIndex: 0 } } },
            { score: 0.016, distance: 0, doc: { pageContent: 'chunk2', metadata: { path: 'b.md', chunkIndex: 0 } } },
        ];
        const worker = new MockWorker(true, hybridResults);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        const embedding = [0.1, 0.2, 0.3];
        const results = await index.searchHybrid(embedding, '"渲 染"', 8, 12);

        expect(results).toEqual(hybridResults);
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'searchHybrid',
            payload: { queryEmbedding: embedding, ftsQuery: '"渲 染"', k: 8, fusionTopK: 12 },
        }));
    });

    it('sends searchHybrid with null ftsQuery when no keyword query', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(true, []);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        const results = await index.searchHybrid([0.1], null, 8, 12);

        expect(results).toEqual([]);
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'searchHybrid',
            payload: { queryEmbedding: [0.1], ftsQuery: null, k: 8, fusionTopK: 12 },
        }));
    });

    it('sends getChunksByPath with exact paths and per-path limit', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const chunkResults = [
            { score: 1, doc: { pageContent: 'chunk1', metadata: { path: 'a.md', chunkIndex: 0 } } },
            { score: 1, doc: { pageContent: 'chunk2', metadata: { path: 'b.md', chunkIndex: 0 } } },
        ];
        const worker = new MockWorker(true, chunkResults);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        const results = await index.getChunksByPath(['a.md', 'b.md'], { limitPerPath: 2 });

        expect(results).toEqual(chunkResults);
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'getChunksByPath',
            payload: { paths: ['a.md', 'b.md'], limitPerPath: 2 },
        }));
    });

    it('reports unsupported worker fallback URLs when direct worker creation is blocked', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class {
                constructor() {
                    throw new DOMException('blocked', 'SecurityError');
                }
            },
        });
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
        });

        await expect(index.getStats()).rejects.toMatchObject({
            code: 'sqlite-worker-url-unsupported',
        });
    });

    it('terminates a worker that resolves after dispose and rejects later requests', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(true, 'ready');
        let resolveWorker: (worker: Worker) => void = () => undefined;
        const workerReady = new Promise<Worker>((resolve) => {
            resolveWorker = resolve;
        });
        const workerFactory = jest.fn(() => workerReady);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory,
        });

        const initializing = index.initialize({
            provider: 'openai',
            baseURL: '',
            model: 'model',
            dimensions: 1024,
            distanceMetric: 'COSINE',
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(workerFactory).toHaveBeenCalled();
        const disposing = index.dispose();
        resolveWorker(worker as unknown as Worker);

        await disposing;
        await expect(initializing).rejects.toMatchObject({ code: 'sqlite-vector-index-disposed' });
        await expect(index.getStats()).rejects.toMatchObject({ code: 'sqlite-vector-index-disposed' });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
});
