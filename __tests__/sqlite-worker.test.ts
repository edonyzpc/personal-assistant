import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { SqliteWorkerRequest, SqliteWorkerResponse } from '../src/vss/sqlite-worker-protocol';

type MockWorkerScope = {
    onmessage?: (event: MessageEvent<SqliteWorkerRequest>) => void;
    postMessage: jest.Mock<(response: SqliteWorkerResponse) => void>;
};

describe('sqlite worker OPFS lifecycle', () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');

    afterEach(() => {
        jest.resetModules();
        jest.dontMock('@sqliteai/sqlite-wasm');
        if (originalSelf) {
            Object.defineProperty(globalThis, 'self', originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it('pauses the OPFS SAH pool after closing the database on dispose', async () => {
        const close = jest.fn();
        const pauseVfs = jest.fn();
        const isPaused = jest.fn(() => false);
        const db = {
            close,
            exec: jest.fn((request: unknown) => {
                if (isExecRowsRequest(request)) {
                    if (request.rowMode === 'array') {
                        request.resultRows.push([0]);
                    }
                }
            }),
        };
        class MockDb {
            constructor() {
                return db;
            }
        }
        const installOpfsSAHPoolVfs = jest.fn(async () => ({
            OpfsSAHPoolDb: MockDb,
            pauseVfs,
            isPaused,
        }));
        const sqlite3InitModule = jest.fn(async () => ({
            installOpfsSAHPoolVfs,
        }));
        const workerScope: MockWorkerScope = {
            postMessage: jest.fn(),
        };
        Object.defineProperty(globalThis, 'self', {
            configurable: true,
            value: workerScope,
        });
        jest.doMock('@sqliteai/sqlite-wasm', () => ({
            __esModule: true,
            default: sqlite3InitModule,
        }));
        await import('../src/vss/sqlite-worker');

        await send(workerScope, {
            id: 1,
            type: 'initialize',
            payload: {
                profile: {
                    provider: 'openai',
                    baseURL: '',
                    model: 'model',
                    dimensions: 1024,
                    distanceMetric: 'COSINE',
                },
                databaseName: 'personal-assistant-vss-test.sqlite3',
                opfsDirectory: '/personal-assistant-vss-v2/test',
                legacyOpfsDirectory: '/personal-assistant-vss',
                opfsVfsName: 'opfs-sahpool-test',
                wasmUrl: 'blob:sqlite-wasm',
            },
        });
        await send(workerScope, {
            id: 2,
            type: 'dispose',
            payload: {},
        });

        expect(close).toHaveBeenCalledTimes(1);
        expect(pauseVfs).toHaveBeenCalledTimes(1);
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(pauseVfs.mock.invocationCallOrder[0]);
    });

    it('waits for an in-flight initialize before disposing the OPFS SAH pool', async () => {
        const close = jest.fn();
        const pauseVfs = jest.fn();
        const isPaused = jest.fn(() => false);
        const db = {
            close,
            exec: jest.fn((request: unknown) => {
                if (isExecRowsRequest(request) && request.rowMode === 'array') {
                    request.resultRows.push([0]);
                }
            }),
        };
        class MockDb {
            constructor() {
                return db;
            }
        }
        let resolveInstall: (pool: unknown) => void = () => undefined;
        const installPromise = new Promise((resolve) => {
            resolveInstall = resolve;
        });
        const installOpfsSAHPoolVfs = jest.fn(() => installPromise);
        const sqlite3InitModule = jest.fn(async () => ({
            installOpfsSAHPoolVfs,
        }));
        const workerScope: MockWorkerScope = {
            postMessage: jest.fn(),
        };
        Object.defineProperty(globalThis, 'self', {
            configurable: true,
            value: workerScope,
        });
        jest.doMock('@sqliteai/sqlite-wasm', () => ({
            __esModule: true,
            default: sqlite3InitModule,
        }));
        await import('../src/vss/sqlite-worker');

        dispatch(workerScope, {
            id: 1,
            type: 'initialize',
            payload: {
                profile: {
                    provider: 'openai',
                    baseURL: '',
                    model: 'model',
                    dimensions: 1024,
                    distanceMetric: 'COSINE',
                },
                databaseName: 'personal-assistant-vss-test.sqlite3',
                opfsDirectory: '/personal-assistant-vss-v2/test',
                legacyOpfsDirectory: '/personal-assistant-vss',
                opfsVfsName: 'opfs-sahpool-test',
                wasmUrl: 'blob:sqlite-wasm',
            },
        });
        await flushMicrotasks();
        dispatch(workerScope, {
            id: 2,
            type: 'dispose',
            payload: {},
        });
        await flushMicrotasks();

        expect(workerScope.postMessage).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(pauseVfs).not.toHaveBeenCalled();

        resolveInstall({
            OpfsSAHPoolDb: MockDb,
            pauseVfs,
            isPaused,
        });
        await flushAsyncWork();

        const responses = workerScope.postMessage.mock.calls.map((call) => call[0]);
        expect(responses.map((response) => response.id)).toEqual([1, 2]);
        expect(responses.every((response) => response.ok)).toBe(true);
        expect(close).toHaveBeenCalledTimes(1);
        expect(pauseVfs).toHaveBeenCalledTimes(1);
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(pauseVfs.mock.invocationCallOrder[0]);
    });
});

async function send(scope: MockWorkerScope, request: SqliteWorkerRequest): Promise<SqliteWorkerResponse> {
    dispatch(scope, request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return scope.postMessage.mock.calls.at(-1)?.[0] as SqliteWorkerResponse;
}

function dispatch(scope: MockWorkerScope, request: SqliteWorkerRequest): void {
    scope.onmessage?.({ data: request } as MessageEvent<SqliteWorkerRequest>);
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

async function flushAsyncWork(): Promise<void> {
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushMicrotasks();
}

function isExecRowsRequest(request: unknown): request is { rowMode: string; resultRows: unknown[][] } {
    return Boolean(
        request
        && typeof request === 'object'
        && 'resultRows' in request
        && Array.isArray((request as { resultRows?: unknown }).resultRows),
    );
}
