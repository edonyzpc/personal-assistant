import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { SqliteVectorIndex } from '../src/vss/sqlite-vector-index';
import type {
    SqliteWorkerMessage,
    SqliteWorkerResponse,
} from '../src/vss/sqlite-worker-protocol';
import type { VSSIndexStats } from '../src/vss/types';
import { RETRIEVAL_CALIBRATION_PROFILE } from '../src/vss/retrieval-calibration';

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
    postMessage = jest.fn((request: SqliteWorkerMessage) => {
        if (!this.respond || !("id" in request)) return;
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

    succeedRequest(id: number, result: unknown): void {
        this.onmessage?.({
            data: { id, ok: true, result },
        } as MessageEvent<SqliteWorkerResponse>);
    }

    failRequest(id: number, code: string): void {
        this.onmessage?.({
            data: { id, ok: false, error: { code, message: code } },
        } as MessageEvent<SqliteWorkerResponse>);
    }
}

async function waitForPostMessage(worker: MockWorker): Promise<void> {
    for (let i = 0; i < 10; i++) {
        if (worker.postMessage.mock.calls.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Worker postMessage was not called.');
}

async function waitForMockCalls(
    mockFn: { mock: { calls: unknown[][] } },
    expectedCount: number,
): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (mockFn.mock.calls.length >= expectedCount) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Mock was not called ${expectedCount} times.`);
}

async function waitForWorkerControl(
    worker: MockWorker,
    type: 'cancelGraphRank' | 'cancelPathEvidenceGeneration',
): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (worker.postMessage.mock.calls.some((call) => call[0].type === type)) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Worker control ${type} was not posted.`);
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

    it('sends initialize only once on first explicit call', async () => {
        Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { } });
        const worker = new MockWorker(true, { status: 'ready' });
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        await index.initialize({ provider: 'qwen', model: 'text-embedding-v4', dimensions: 1024, baseURL: 'https://example.com/v1', distanceMetric: 'COSINE' });

        const initCalls = worker.postMessage.mock.calls.filter(
            (call: [SqliteWorkerMessage]) => call[0].type === 'initialize',
        );
        expect(initCalls).toHaveLength(1);
    });

    it('preserves original error code when first initialize fails', async () => {
        Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { } });
        const worker = new MockWorker(false);
        worker.postMessage = jest.fn((request: SqliteWorkerMessage) => {
            if (!("id" in request)) return;
            queueMicrotask(() => {
                worker.onmessage?.({
                    data: { id: request.id, ok: false, error: { code: 'opfs-sahpool-locked', message: 'Pool is locked' } },
                } as MessageEvent<SqliteWorkerResponse>);
            });
        }) as typeof worker.postMessage;
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        await expect(
            index.initialize({ provider: 'qwen', model: 'text-embedding-v4', dimensions: 1024, baseURL: 'https://example.com/v1', distanceMetric: 'COSINE' }),
        ).rejects.toThrow('Pool is locked');
    });

    it('reinitializes replacement Worker before the next operation after error', async () => {
        Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { } });
        let firstCallCount = 0;
        const firstWorker = new MockWorker(false);
        firstWorker.postMessage = jest.fn((request: SqliteWorkerMessage) => {
            if (!("id" in request)) return;
            firstCallCount++;
            if (request.type === 'initialize') {
                queueMicrotask(() => {
                    firstWorker.onmessage?.({
                        data: { id: request.id, ok: true, result: { status: 'ready' } },
                    } as MessageEvent<SqliteWorkerResponse>);
                });
            }
        }) as typeof firstWorker.postMessage;
        const secondWorker = new MockWorker(true, readyStats);
        const workerQueue = [firstWorker, secondWorker];
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => workerQueue.shift() as unknown as Worker,
        });

        await index.initialize({ provider: 'qwen', model: 'text-embedding-v4', dimensions: 1024, baseURL: 'https://example.com/v1', distanceMetric: 'COSINE' });

        const failedStats = index.getStats();
        await new Promise((r) => setTimeout(r, 0));
        firstWorker.fail('worker crashed');
        await expect(failedStats).rejects.toThrow('worker crashed');

        await index.getStats();

        const secondMessages = secondWorker.postMessage.mock.calls.map(
            (call: [SqliteWorkerMessage]) => call[0].type,
        );
        expect(secondMessages).toEqual(['initialize', 'getStats']);
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
        const worker = new MockWorker(true, {
            results: hybridResults,
            lexical: { attempted: true, state: 'ready', matchedRows: 2 },
        });
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        const embedding = [0.1, 0.2, 0.3];
        const lexicalBudget = { startedAtMs: 100, deadlineAtMs: 600 };
        const results = await index.searchHybrid(
            embedding,
            '"渲 染"',
            8,
            12,
            undefined,
            undefined,
            undefined,
            lexicalBudget,
        );

        expect(results).toEqual(hybridResults);
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'searchHybrid',
            payload: expect.objectContaining({
                queryEmbedding: embedding,
                ftsQuery: '"渲 染"',
                k: 8,
                fusionTopK: 12,
                lexicalBudget,
            }),
        }));
    });

    it('sends searchHybrid with null ftsQuery when no keyword query', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(true, {
            results: [],
            lexical: { attempted: false, state: 'ready', reason: 'query_empty' },
        });
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

    it('rejects an aborted queued hybrid search without dispatching it to the Worker', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        const blocker = index.getStats();
        const blockerRequest = await waitForWorkerRequest(worker, 'getStats');
        const controller = new AbortController();
        const queued = index.searchHybridDetailed(
            [0.1],
            null,
            8,
            12,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { signal: controller.signal },
        );
        const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });

        controller.abort();
        await rejected;
        worker.succeedRequest(blockerRequest.id, readyStats);
        await blocker;
        await Promise.resolve();
        await Promise.resolve();

        expect(worker.postMessage.mock.calls.map((call) => call[0])).toEqual([
            expect.objectContaining({ type: 'getStats' }),
        ]);
    });

    it('discards an active hybrid late result and isolates the next queued search', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        const controller = new AbortController();
        const first = index.searchHybridDetailed(
            [0.1],
            '"stale"',
            8,
            12,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { signal: controller.signal },
        );
        const firstRequest = await waitForWorkerRequest(worker, 'searchHybrid');
        const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });

        controller.abort();
        await firstRejected;
        const second = index.searchHybridDetailed([0.2], '"fresh"', 8, 12);
        let secondSettled = false;
        void second.then(
            () => { secondSettled = true; },
            () => { secondSettled = true; },
        );
        await Promise.resolve();
        expect(secondSettled).toBe(false);
        expect(worker.postMessage.mock.calls.filter((call) => call[0].type === 'searchHybrid')).toHaveLength(1);

        worker.succeedRequest(firstRequest.id, {
            results: [{ score: 1, doc: { pageContent: 'stale', metadata: { path: 'stale.md' } } }],
            sourceEpoch: 'stale-epoch',
            lexical: { attempted: true, state: 'ready', matchedRows: 99 },
        });
        const secondRequest = await waitForWorkerRequest(worker, 'searchHybrid', firstRequest.id);
        worker.succeedRequest(secondRequest.id, {
            results: [{ score: 0.5, doc: { pageContent: 'fresh', metadata: { path: 'fresh.md' } } }],
            sourceEpoch: 'fresh-epoch',
            lexical: { attempted: true, state: 'ready', matchedRows: 1 },
        });

        await expect(second).resolves.toMatchObject({
            sourceEpoch: 'fresh-epoch',
            results: [expect.objectContaining({
                doc: expect.objectContaining({ metadata: expect.objectContaining({ path: 'fresh.md' }) }),
            })],
        });
    });

    it('sends independent versioned retrieval parameters without changing legacy aliases', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(true, {
            results: [],
            lexical: { attempted: true, state: 'ready', matchedRows: 0 },
        });
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        const retrieval = RETRIEVAL_CALIBRATION_PROFILE.candidate.standard;

        await index.searchHybrid(
            [0.1],
            '"c5dee c65c5"',
            retrieval.vectorRaw,
            retrieval.fusionRaw,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            retrieval,
        );

        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'searchHybrid',
            payload: expect.objectContaining({
                k: 8,
                fusionTopK: 18,
                retrieval: {
                    profileId: 'ec02-char-phrase-runtime-v1',
                    profileVersion: 1,
                    variant: 'candidate',
                    mode: 'standard',
                    provisional: true,
                    evidence: 'offline_provisional_winner',
                    vectorRaw: 8,
                    lexicalRaw: 12,
                    fusionRaw: 18,
                    queryMode: 'clause_OR',
                    bm25Weights: [1.25, 1.25, 2, 0.25],
                    rrf: { k: 30, sourceWeights: [1, 1] },
                },
            }),
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

    it('cancels a dispatched legacy evidence repair and releases the queue for the next foreground lookup', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        const controller = new AbortController();
        const control = pathEvidenceControl('legacy-repair');
        const lookup = index.getPathEvidenceGenerations(
            ['legacy.md'],
            control,
            1,
            100,
            { signal: controller.signal },
        );
        const request = await waitForWorkerRequest(worker, 'getPathEvidenceGenerations');
        const foreground = index.getFileRecord('foreground.md');

        controller.abort();
        await expect(lookup).rejects.toMatchObject({ code: 'path-evidence-aborted' });
        expect(worker.postMessage.mock.calls.map((call) => call[0])).toContainEqual({
            type: 'cancelPathEvidenceGeneration',
            payload: { requestId: control.requestId, runEpoch: control.runEpoch },
        });
        expect(worker.postMessage.mock.calls.map((call) => call[0])).not.toContainEqual(
            expect.objectContaining({ type: 'getFileRecord' }),
        );

        worker.failRequest(request.id, 'path-evidence-aborted');
        const foregroundRequest = await waitForWorkerRequest(worker, 'getFileRecord', request.id);
        worker.succeedRequest(foregroundRequest.id, null);
        await expect(foreground).resolves.toBeNull();
        expect(pathEvidenceRegistrySizes(index)).toEqual({ active: 0, cancelled: 0 });
    });

    it('does not dispatch evidence repair after abort during replacement Worker initialization', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const firstWorker = new MockWorker(false);
        firstWorker.postMessage = jest.fn((request: SqliteWorkerMessage) => {
            if (!("id" in request) || request.type !== 'initialize') return;
            queueMicrotask(() => firstWorker.succeedRequest(request.id, { status: 'ready' }));
        }) as typeof firstWorker.postMessage;
        const replacementWorker = new MockWorker(false);
        let resolveReplacement: (worker: Worker) => void = () => undefined;
        const replacementReady = new Promise<Worker>((resolve) => {
            resolveReplacement = resolve;
        });
        const workerFactory = jest.fn<(url: string) => Worker | Promise<Worker>>()
            .mockImplementationOnce(() => firstWorker as unknown as Worker)
            .mockImplementationOnce(() => replacementReady);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory,
        });
        await index.initialize({
            provider: 'openai',
            baseURL: '',
            model: 'model',
            dimensions: 2,
            distanceMetric: 'COSINE',
        });

        const failedStats = index.getStats();
        await waitForWorkerRequest(firstWorker, 'getStats');
        firstWorker.fail('replacement required');
        await expect(failedStats).rejects.toThrow('replacement required');

        const controller = new AbortController();
        const control = pathEvidenceControl('replacement-init-abort');
        const lookup = index.getPathEvidenceGenerations(
            ['legacy.md'],
            control,
            1,
            100,
            { signal: controller.signal },
        );
        await waitForMockCalls(workerFactory, 2);
        controller.abort();
        await expect(lookup).rejects.toMatchObject({ code: 'path-evidence-aborted' });

        const foreground = index.getFileRecord('foreground.md');
        resolveReplacement(replacementWorker as unknown as Worker);
        const replacementInitialize = await waitForWorkerRequest(replacementWorker, 'initialize');
        await waitForWorkerControl(replacementWorker, 'cancelPathEvidenceGeneration');
        expect(replacementWorker.postMessage.mock.calls.map((call) => call[0])).toContainEqual({
            type: 'cancelPathEvidenceGeneration',
            payload: { requestId: control.requestId, runEpoch: control.runEpoch },
        });
        replacementWorker.succeedRequest(replacementInitialize.id, { status: 'ready' });
        const foregroundRequest = await waitForWorkerRequest(
            replacementWorker,
            'getFileRecord',
            replacementInitialize.id,
        );
        replacementWorker.succeedRequest(foregroundRequest.id, null);
        await expect(foreground).resolves.toBeNull();
        await waitForPathEvidenceRegistriesEmpty(index);

        expect(replacementWorker.postMessage.mock.calls
            .map((call) => call[0])
            .filter((message) => 'id' in message && message.type === 'getPathEvidenceGenerations'))
            .toEqual([]);
        expect(pathEvidenceRegistrySizes(index)).toEqual({ active: 0, cancelled: 0 });
        expect(workerFactory).toHaveBeenCalledTimes(2);
    });

    it('posts graph cancellation immediately even while the data queue is blocked', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        void index.getStats();
        await waitForPostMessage(worker);
        const controller = new AbortController();
        const control = {
            requestId: 'rank-1',
            runEpoch: 'run-1',
            sourceEpoch: 'source-1',
            absoluteDeadlineMs: Date.now() + 10_000,
            maxPathsPerBatch: 16,
            maxCandidatePaths: 32,
            maxChunksScanned: 256,
        };
        const diagnostics: Array<{ state: string; accepted?: 0 | 1 }> = [];
        const ranked = index.rankGraphCandidates([1, 0], ['a.md'], control, {
            signal: controller.signal,
            onDiagnostic: (event) => diagnostics.push(event),
        });
        controller.abort();

        await expect(ranked).rejects.toMatchObject({ code: 'graph-rank-aborted' });
        expect(worker.postMessage.mock.calls.map((call) => call[0])).toEqual([
            expect.objectContaining({ type: 'getStats' }),
            {
                type: 'cancelGraphRank',
                payload: { requestId: 'rank-1', runEpoch: 'run-1' },
            },
        ]);
        expect(diagnostics).toContainEqual(expect.objectContaining({
            state: 'cancel_requested',
            accepted: 0,
        }));
        expect(diagnostics).not.toContainEqual(expect.objectContaining({ state: 'cancel_observed' }));
    });

    it('rejects a graph result that does not prove the requested source epoch', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(true, {
            requestId: 'rank-2',
            runEpoch: 'run-1',
            sourceEpoch: 'stale-source',
            paths: [{ path: 'a.md', maxScore: 1, chunks: [] }],
        });
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        await expect(index.rankGraphCandidates([1, 0], ['a.md'], {
            requestId: 'rank-2',
            runEpoch: 'run-1',
            sourceEpoch: 'source-2',
            absoluteDeadlineMs: Date.now() + 10_000,
            maxPathsPerBatch: 16,
            maxCandidatePaths: 32,
            maxChunksScanned: 256,
        })).rejects.toMatchObject({ code: 'graph-rank-epoch-mismatch' });
    });

    it('cleans graph registries before success/error settlement and ignores repeated late cancels', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });

        const firstControl = graphControl('rank-success');
        const successDiagnostics: Array<{ state: string; accepted?: 0 | 1 }> = [];
        const succeeded = index.rankGraphCandidates([1, 0], ['a.md'], firstControl, {
            onDiagnostic: (event) => successDiagnostics.push(event),
        });
        const firstRequest = await waitForWorkerRequest(worker, 'rankGraphCandidates');
        worker.succeedRequest(firstRequest.id, graphResult(firstControl, ['a.md']));
        await expect(succeeded).resolves.toMatchObject({ requestId: 'rank-success' });
        expect(graphRegistrySizes(index)).toEqual({ active: 0, cancelled: 0 });
        expect(successDiagnostics).toContainEqual(expect.objectContaining({
            state: 'settled',
            accepted: 1,
        }));

        const successPostCount = worker.postMessage.mock.calls.length;
        index.cancelGraphRank(firstControl.requestId, firstControl.runEpoch);
        index.cancelGraphRank(firstControl.requestId, firstControl.runEpoch);
        expect(worker.postMessage).toHaveBeenCalledTimes(successPostCount);

        const secondControl = graphControl('rank-error');
        const failed = index.rankGraphCandidates([1, 0], ['a.md'], secondControl);
        const secondRequest = await waitForWorkerRequest(worker, 'rankGraphCandidates', firstRequest.id);
        worker.failRequest(secondRequest.id, 'graph-rank-worker-error');
        await expect(failed).rejects.toMatchObject({ code: 'graph-rank-worker-error' });
        expect(graphRegistrySizes(index)).toEqual({ active: 0, cancelled: 0 });

        const errorPostCount = worker.postMessage.mock.calls.length;
        index.cancelGraphRank(secondControl.requestId, secondControl.runEpoch);
        index.cancelGraphRank(secondControl.requestId, secondControl.runEpoch);
        expect(worker.postMessage).toHaveBeenCalledTimes(errorPostCount);
    });

    it('cleans graph registries after a cancelled request returns a late success', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        const control = graphControl('rank-cancelled');
        const controller = new AbortController();
        const diagnostics: Array<{ state: string; accepted?: 0 | 1 }> = [];
        const ranked = index.rankGraphCandidates([1, 0], ['a.md'], control, {
            signal: controller.signal,
            onDiagnostic: (event) => diagnostics.push(event),
        });
        const request = await waitForWorkerRequest(worker, 'rankGraphCandidates');

        controller.abort();
        await expect(ranked).rejects.toMatchObject({ code: 'graph-rank-aborted' });
        expect(worker.postMessage.mock.calls.map((call) => call[0])).toContainEqual({
            type: 'cancelGraphRank',
            payload: { requestId: control.requestId, runEpoch: control.runEpoch },
        });

        worker.succeedRequest(request.id, graphResult(control, ['a.md']));
        await waitForGraphRegistriesEmpty(index);
        expect(graphRegistrySizes(index)).toEqual({ active: 0, cancelled: 0 });
        expect(diagnostics).toContainEqual(expect.objectContaining({
            state: 'late_discarded',
            accepted: 0,
        }));
        expect(diagnostics).not.toContainEqual(expect.objectContaining({ state: 'cancel_observed' }));

        const postCount = worker.postMessage.mock.calls.length;
        index.cancelGraphRank(control.requestId, control.runEpoch);
        index.cancelGraphRank(control.requestId, control.runEpoch);
        expect(worker.postMessage).toHaveBeenCalledTimes(postCount);
    });

    it('reports cancel_observed only after the dispatched Worker rejects with graph-rank-aborted', async () => {
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: class { },
        });
        const worker = new MockWorker(false);
        const index = new SqliteVectorIndex({
            workerUrl: 'vss-sqlite-worker.js',
            workerFactory: () => worker as unknown as Worker,
        });
        const control = graphControl('rank-worker-cancelled');
        const controller = new AbortController();
        const diagnostics: Array<{ state: string; accepted?: 0 | 1 }> = [];
        const ranked = index.rankGraphCandidates([1, 0], ['a.md'], control, {
            signal: controller.signal,
            onDiagnostic: (event) => diagnostics.push(event),
        });
        const request = await waitForWorkerRequest(worker, 'rankGraphCandidates');

        controller.abort();
        await expect(ranked).rejects.toMatchObject({ code: 'graph-rank-aborted' });
        worker.failRequest(request.id, 'graph-rank-aborted');
        await waitForGraphRegistriesEmpty(index);

        expect(diagnostics).toContainEqual(expect.objectContaining({
            state: 'cancel_requested',
            accepted: 0,
        }));
        expect(diagnostics).toContainEqual(expect.objectContaining({
            state: 'cancel_observed',
            accepted: 0,
        }));
        expect(diagnostics).toContainEqual(expect.objectContaining({
            state: 'late_discarded',
            accepted: 0,
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

function graphControl(requestId: string) {
    return {
        requestId,
        runEpoch: 'run-registry',
        sourceEpoch: 'source-registry',
        absoluteDeadlineMs: Date.now() + 10_000,
        maxPathsPerBatch: 16,
        maxCandidatePaths: 32,
        maxChunksScanned: 256,
    };
}

function pathEvidenceControl(requestId: string) {
    return {
        requestId,
        runEpoch: 'path-evidence-run',
        absoluteDeadlineMs: Date.now() + 10_000,
    };
}

function graphResult(control: ReturnType<typeof graphControl>, paths: string[]) {
    return {
        requestId: control.requestId,
        runEpoch: control.runEpoch,
        sourceEpoch: control.sourceEpoch,
        paths: paths.map((path) => ({
            path,
            pathEvidenceGeneration: `generation:${path}`,
            maxScore: 1,
            chunks: [{
                chunkIndex: 0,
                score: 1,
                doc: {
                    pageContent: `content:${path}`,
                    metadata: {
                        path,
                        chunkIndex: 0,
                        pathEvidenceGeneration: `generation:${path}`,
                    },
                },
            }],
        })),
    };
}

async function waitForWorkerRequest(
    worker: MockWorker,
    type: Extract<SqliteWorkerMessage, { id: number }>['type'],
    afterId = 0,
): Promise<Extract<SqliteWorkerMessage, { id: number }>> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const request = worker.postMessage.mock.calls
            .map((call) => call[0])
            .find((candidate): candidate is Extract<SqliteWorkerMessage, { id: number }> => (
                'id' in candidate && candidate.id > afterId && candidate.type === type
            ));
        if (request) return request;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Worker request ${type} was not posted.`);
}

function graphRegistrySizes(index: SqliteVectorIndex): { active: number; cancelled: number } {
    const internal = index as unknown as {
        activeGraphRequests: Set<string>;
        cancelledGraphRequests: Set<string>;
    };
    return {
        active: internal.activeGraphRequests.size,
        cancelled: internal.cancelledGraphRequests.size,
    };
}

async function waitForGraphRegistriesEmpty(index: SqliteVectorIndex): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const sizes = graphRegistrySizes(index);
        if (sizes.active === 0 && sizes.cancelled === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Graph request registries did not drain.');
}

function pathEvidenceRegistrySizes(index: SqliteVectorIndex): { active: number; cancelled: number } {
    const internal = index as unknown as {
        activePathEvidenceRequests: Set<string>;
        cancelledPathEvidenceRequests: Set<string>;
    };
    return {
        active: internal.activePathEvidenceRequests.size,
        cancelled: internal.cancelledPathEvidenceRequests.size,
    };
}

async function waitForPathEvidenceRegistriesEmpty(index: SqliteVectorIndex): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const sizes = pathEvidenceRegistrySizes(index);
        if (sizes.active === 0 && sizes.cancelled === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Path evidence request registries did not drain.');
}
