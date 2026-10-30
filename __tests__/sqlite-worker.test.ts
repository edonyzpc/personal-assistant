import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
    SqliteWorkerMessage,
    SqliteWorkerRequest,
    SqliteWorkerResponse,
} from '../src/vss/sqlite-worker-protocol';

type MockWorkerScope = {
    crypto: Crypto;
    onmessage?: (event: MessageEvent<SqliteWorkerMessage>) => void;
    postMessage: jest.Mock<(response: SqliteWorkerResponse) => void>;
};

describe('sqlite worker OPFS lifecycle', () => {
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');

    afterEach(() => {
        jest.resetModules();
        jest.dontMock('@sqlite.org/sqlite-wasm');
        if (originalSelf) {
            Object.defineProperty(globalThis, 'self', originalSelf);
        } else {
            delete (globalThis as { self?: unknown }).self;
        }
    });

    it('keeps a missing store absent without creating a directory or loading SQLite', async () => {
        const fixture = await setupStorageInspectionWorker([]);
        fixture.root.getDirectoryHandle.mockRejectedValueOnce(notFoundError());
        const response = await send(fixture.scope, { id: 1, type: 'inspectStorage',
            payload: { databaseName: 'memory.sqlite3', opfsDirectory: '/owned' } });
        expect(response).toEqual({ id: 1, ok: true, result: { state: 'absent' } });
        expect(fixture.root.getDirectoryHandle).toHaveBeenCalledWith('owned', { create: false });
        expect(fixture.init).not.toHaveBeenCalled();
        expect(fixture.root.removeEntry).not.toHaveBeenCalled();
    });

    it('reads the V2 SAH mapping and profile only from a read-only in-memory snapshot', async () => {
        const bytes = opaqueFile('/memory.sqlite3', new Uint8Array([1, 2, 3]), true);
        const before = bytes.slice();
        const fixture = await setupStorageInspectionWorker([bytes]);
        const response = await send(fixture.scope, { id: 1, type: 'inspectStorage',
            payload: { databaseName: 'memory.sqlite3', opfsDirectory: '/owned' } });
        expect(response).toEqual({ id: 1, ok: true, result: { state: 'known', profileSignature: 'old-profile' } });
        expect(fixture.files[0].createSyncAccessHandle).toHaveBeenCalledWith({ mode: 'read-only' });
        expect(fixture.deserialize).toHaveBeenCalledWith(16, 'main', 32, 3, 23, 4);
        expect(fixture.database.exec).toHaveBeenCalledWith({ sql: 'SELECT value FROM vss_meta WHERE key = ? LIMIT 2',
            bind: ['profileSignature'], rowMode: 'object', resultRows: [{ value: 'old-profile' }] });
        expect(fixture.database.close.mock.invocationCallOrder[0]).toBeLessThan(fixture.dealloc.mock.invocationCallOrder[0]);
        expect(fixture.installPool).not.toHaveBeenCalled();
        expect(fixture.handles[0].write).not.toHaveBeenCalled();
        expect(fixture.handles[0].truncate).not.toHaveBeenCalled();
        expect(fixture.handles[0].close).toHaveBeenCalledTimes(1);
        expect(bytes).toEqual(before);
    });

    it('preserves a bad mapping and does not let SAH-pool repair truncate it', async () => {
        const bytes = opaqueFile('/memory.sqlite3', new Uint8Array([1, 2, 3]), true);
        bytes[516] ^= 1;
        const before = bytes.slice();
        const fixture = await setupStorageInspectionWorker([bytes]);
        expect(await send(fixture.scope, { id: 1, type: 'inspectStorage',
            payload: { databaseName: 'memory.sqlite3', opfsDirectory: '/owned' } }))
            .toMatchObject({ ok: true, result: { state: 'unknown', reason: 'opaque_header_invalid' } });
        expect(fixture.init).not.toHaveBeenCalled();
        expect(fixture.handles[0].truncate).not.toHaveBeenCalled();
        expect(bytes).toEqual(before);
    });

    it('does not infer a profile from a database with an associated journal', async () => {
        const fixture = await setupStorageInspectionWorker([
            opaqueFile('/memory.sqlite3'), opaqueFile('/memory.sqlite3-journal'),
        ]);
        expect(await send(fixture.scope, { id: 1, type: 'inspectStorage',
            payload: { databaseName: 'memory.sqlite3', opfsDirectory: '/owned' } }))
            .toMatchObject({ ok: true, result: { state: 'unknown', reason: 'storage_journal_present' } });
        expect(fixture.init).not.toHaveBeenCalled();
        expect(fixture.handles.every(handle => handle.close.mock.calls.length === 1)).toBe(true);
    });

    it('releases earlier read handles when another pool holds the target file', async () => {
        const fixture = await setupStorageInspectionWorker([opaqueFile(''), opaqueFile('/memory.sqlite3')]);
        const locked = new Error('Access Handles cannot be opened');
        locked.name = 'NoModificationAllowedError';
        fixture.files[1].createSyncAccessHandle.mockRejectedValueOnce(locked);
        expect(await send(fixture.scope, { id: 1, type: 'inspectStorage',
            payload: { databaseName: 'memory.sqlite3', opfsDirectory: '/owned' } }))
            .toMatchObject({ ok: true, result: { state: 'unknown', reason: 'storage_locked' } });
        expect(fixture.handles[0].close).toHaveBeenCalledTimes(1);
        expect(fixture.init).not.toHaveBeenCalled();
    });

    it.each(['missing-metadata', 'invalid-database', 'allocation-failed'])(
        'keeps %s unknown while releasing read handles and memory', async failure => {
            const fixture = await setupStorageInspectionWorker([opaqueFile('/memory.sqlite3')],
                failure === 'missing-metadata' ? null : 'old-profile');
            if (failure === 'invalid-database') fixture.deserialize.mockReturnValueOnce(26);
            if (failure === 'allocation-failed') fixture.alloc.mockImplementationOnce(() => { throw new RangeError('memory unavailable'); });
            expect(await send(fixture.scope, { id: 1, type: 'inspectStorage',
                payload: { databaseName: 'memory.sqlite3', opfsDirectory: '/owned' } }))
                .toMatchObject({ ok: true, result: { state: 'unknown' } });
            expect(fixture.handles[0].close).toHaveBeenCalledTimes(1);
            expect(fixture.database.close).toHaveBeenCalledTimes(1);
            expect(fixture.installPool).not.toHaveBeenCalled();
        },
    );

    it('clears only an explicitly owned directory without needing readable profile metadata', async () => {
        const fixture = await setupStorageInspectionWorker([new Uint8Array([0])]);
        expect(await send(fixture.scope, { id: 1, type: 'removeStorage', payload: { opfsDirectory: '/owned' } }))
            .toEqual({ id: 1, ok: true, result: null });
        expect(fixture.root.removeEntry).toHaveBeenCalledWith('owned', { recursive: true });
        expect(fixture.init).not.toHaveBeenCalled();
        fixture.root.removeEntry.mockRejectedValueOnce(notFoundError());
        expect(await send(fixture.scope, { id: 2, type: 'removeStorage', payload: { opfsDirectory: '/owned' } }))
            .toMatchObject({ ok: true });
    });

    it('does not turn a failed or unscoped storage removal into success', async () => {
        const fixture = await setupStorageInspectionWorker([]);
        fixture.root.removeEntry.mockRejectedValueOnce(new Error('storage locked'));
        expect(await send(fixture.scope, { id: 1, type: 'removeStorage', payload: { opfsDirectory: '/owned' } }))
            .toMatchObject({ ok: false });
        expect(await send(fixture.scope, { id: 2, type: 'removeStorage', payload: {} }))
            .toMatchObject({ ok: false, error: { code: 'storage_path_invalid' } });
        expect(fixture.root.removeEntry).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('closes the current DB and requires a successful pool release before removal (pause failure: %s)', async fails => {
        const fixture = await setupStorageInspectionWorker([]);
        const close = jest.fn();
        const pauseVfs = jest.fn(() => { if (fails) throw new Error('pool locked'); });
        const database = { close, exec: jest.fn((request: unknown) => {
            if (isExecRowsRequest(request) && request.rowMode === 'array') {
                request.resultRows.push([isPragmaTableInfoQuery(request) ? 1 : 0]);
            }
        }) };
        class MockDb { constructor() { return database; } }
        fixture.installPool.mockImplementationOnce(async () => ({ OpfsSAHPoolDb: MockDb, pauseVfs }));
        expect(await send(fixture.scope, { id: 1, type: 'initialize', payload: {
            databaseName: 'memory.sqlite3', opfsDirectory: '/owned',
            profile: { provider: 'openai', model: 'model', baseURL: '', dimensions: 2, distanceMetric: 'COSINE' },
        } })).toMatchObject({ ok: true });
        const response = await send(fixture.scope, { id: 2, type: 'removeStorage', payload: { opfsDirectory: '/owned' } });
        expect(close).toHaveBeenCalledTimes(1);
        expect(pauseVfs).toHaveBeenCalledTimes(1);
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(pauseVfs.mock.invocationCallOrder[0]);
        expect(response.ok).toBe(!fails);
        expect(fixture.root.removeEntry).toHaveBeenCalledTimes(fails ? 0 : 1);
    });

    it('runs the actual worker snapshot path against the installed SQLite engine', async () => {
        // This isolated source harness compiles in memory only. Its OPFS is a
        // synthetic byte fixture; no build assets or real vault are touched.
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
            import init from '@sqlite.org/sqlite-wasm';
            import { build, stop } from 'esbuild';
            const sqlite = await init();
            const source = new sqlite.oo1.DB(':memory:');
            source.exec('CREATE TABLE vss_meta(key TEXT PRIMARY KEY, value TEXT)');
            source.exec({sql:'INSERT INTO vss_meta VALUES(?,?)', bind:['profileSignature','original-profile']});
            const image = sqlite.capi.sqlite3_js_db_export(source.pointer);
            source.close();
            const file = new Uint8Array(4096 + image.byteLength);
            file.set(new TextEncoder().encode('/memory.sqlite3'));
            new DataView(file.buffer).setUint32(512, 0x180);
            file.set([219,230,50,104,27,215,249,217],516);
            file.set(image,4096);
            const before = file.slice();
            let opened = 0, closed = 0;
            const opaque = {kind:'directory', async *entries(){yield ['opaque-file',{
                kind:'file', createSyncAccessHandle:async options => {
                    if(options.mode !== 'read-only') throw Error('write handle');
                    opened++;
                    return { getSize:()=>file.length, close:()=>closed++,
                        read:(out,options)=>{const bytes=file.subarray(options.at,options.at+out.length);out.set(bytes);return bytes.length;},
                        write:()=>{throw Error('write');},truncate:()=>{throw Error('truncate');} };
                }
            }];}};
            const store = {getDirectoryHandle:async(name,options)=>{
                if(name!=='.opaque'||options.create!==false)throw Error('create or other directory');return opaque;
            }};
            const root = {getDirectoryHandle:async(name,options)=>{
                if(name!=='owned'||options.create!==false)throw Error('create or other vault');return store;
            },removeEntry:()=>{throw Error('delete');}};
            globalThis.self=globalThis;
            Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{getDirectory:async()=>root}}});
            const pending = new Map();
            globalThis.postMessage=response=>pending.get(response.id)(response);
            const runtime=import.meta.resolve('@sqlite.org/sqlite-wasm');
            const compiled=await build({entryPoints:['src/vss/sqlite-worker.ts'],bundle:true,write:false,
                format:'esm',platform:'node',target:'node22',plugins:[{name:'sqlite-runtime',setup(builder){
                    builder.onResolve({filter:new RegExp('^@sqlite[.]org/sqlite-wasm$')},()=>({path:runtime,external:true}));
                }}]});
            await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
            const inspect=id=>new Promise(resolve=>{pending.set(id,resolve);globalThis.onmessage({data:{id,type:'inspectStorage',
                payload:{databaseName:'memory.sqlite3',opfsDirectory:'/owned'}}});});
            const known=await inspect(1);
            const unchanged=Buffer.from(file).equals(Buffer.from(before));
            file[4096]=0;
            const damaged=await inspect(2);
            stop();
            process.stdout.write(JSON.stringify({known,damaged,unchanged,opened,closed}));
        `], { encoding: 'utf8' });
        const actual = JSON.parse(stdout);
        expect(actual.known).toMatchObject({ ok: true, result: { state: 'known', profileSignature: 'original-profile' } });
        expect(actual.damaged).toMatchObject({ ok: true, result: { state: 'unknown' } });
        expect(actual).toMatchObject({ unchanged: true, opened: 2, closed: 2 });
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
                        request.resultRows.push([isPragmaTableInfoQuery(request) ? 1 : 0]);
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
            crypto: globalThis.crypto,
            postMessage: jest.fn(),
        };
        Object.defineProperty(globalThis, 'self', {
            configurable: true,
            value: workerScope,
        });
        jest.doMock('@sqlite.org/sqlite-wasm', () => ({
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
                    request.resultRows.push([isPragmaTableInfoQuery(request) ? 1 : 0]);
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
            crypto: globalThis.crypto,
            postMessage: jest.fn(),
        };
        Object.defineProperty(globalThis, 'self', {
            configurable: true,
            value: workerScope,
        });
        jest.doMock('@sqlite.org/sqlite-wasm', () => ({
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

    it('disables unused async OPFS VFSes without disabling the SAH pool', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const db = {
                close: jest.fn(),
                exec: jest.fn((request: unknown) => {
                    if (isExecRowsRequest(request) && request.rowMode === 'array') {
                        request.resultRows.push([isPragmaTableInfoQuery(request) ? 1 : 0]);
                    }
                }),
            };
            class MockDb {
                constructor() {
                    return db;
                }
            }
            const installOpfsSAHPoolVfs = jest.fn(async (_options: Record<string, unknown>) => ({
                OpfsSAHPoolDb: MockDb,
                pauseVfs: jest.fn(),
                isPaused: jest.fn(() => false),
            }));
            let capturedConfig: {
                warn?: (...args: unknown[]) => void;
                disable?: { vfs?: Record<string, boolean> };
            } | undefined;
            const sqlite3InitModule = jest.fn(async () => {
                capturedConfig = (globalThis.self as {
                    sqlite3ApiConfig?: typeof capturedConfig;
                }).sqlite3ApiConfig;
                capturedConfig?.warn?.(
                    "Ignoring inability to install 'opfs' sqlite3_vfs:",
                    new TypeError("Failed to construct 'URL': Invalid URL"),
                );
                capturedConfig?.warn?.(
                    "Ignoring inability to install the opfs-wl sqlite3_vfs:",
                    new TypeError("Failed to construct 'URL': Invalid URL"),
                );
                return {
                    installOpfsSAHPoolVfs,
                };
            });
            const workerScope: MockWorkerScope = {
                crypto: globalThis.crypto,
                postMessage: jest.fn(),
            };
            Object.defineProperty(globalThis, 'self', {
                configurable: true,
                value: workerScope,
            });
            jest.doMock('@sqlite.org/sqlite-wasm', () => ({
                __esModule: true,
                default: sqlite3InitModule,
            }));
            await import('../src/vss/sqlite-worker');

            const response = await send(workerScope, {
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

            expect(response.ok).toBe(true);
            expect(capturedConfig?.disable?.vfs).toEqual(expect.objectContaining({
                opfs: true,
                'opfs-wl': true,
            }));
            expect(capturedConfig?.disable?.vfs?.['opfs-sahpool']).not.toBe(true);
            expect(installOpfsSAHPoolVfs).toHaveBeenCalledWith(expect.objectContaining({
                name: 'opfs-sahpool-test',
            }));
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('ranks only requested path chunks by real cosine and returns at most three per path', async () => {
        const rows = [
            graphRow(1, 'a.md', 0, [1, 0]),
            graphRow(2, 'a.md', 5, [0.8, 0.2]),
            graphRow(3, 'b.md', 0, [0, 1]),
        ];
        const { workerScope } = await setupGraphRankingWorker(rows, '7');
        dispatch(workerScope, graphRankRequest(2, ['b.md', 'a.md'], '7'));
        const response = await waitForResponse(workerScope, 2);

        expect(response.ok).toBe(true);
        if (!response.ok) return;
        expect(response.result).toMatchObject({
            requestId: 'rank-2',
            runEpoch: 'run-1',
            sourceEpoch: '7',
            paths: [
                {
                    path: 'a.md',
                    maxScore: 1,
                    chunks: [
                        { chunkIndex: 0, score: 1 },
                        { chunkIndex: 5 },
                    ],
                },
                {
                    path: 'b.md',
                    maxScore: 0,
                    chunks: [{ chunkIndex: 0, score: 0 }],
                },
            ],
            diagnostics: {
                batchCount: expect.any(Number),
                chunkCount: 3,
                workerDurationMs: expect.any(Number),
                maxBatchDurationMs: expect.any(Number),
            },
        });
        const result = response.result as { paths: Array<{ chunks: Array<{ doc: { metadata: Record<string, unknown> } }> }> };
        expect(result.paths[0].chunks[0].doc.metadata).toMatchObject({ path: 'a.md', chunkIndex: 0 });
    });

    it('repairs a legacy empty generation only after the complete graph row budget passes', async () => {
        const rows = [
            graphRow(1, 'legacy.md', 0, [1, 0]),
            graphRow(2, 'legacy.md', 1, [0.8, 0.2]),
        ];
        const generations = new Map<string, string>();
        const { workerScope } = await setupGraphRankingWorker(rows, '7', generations);

        dispatch(workerScope, graphRankRequest(2, ['legacy.md'], '7', { maxChunksScanned: 2 }));
        const response = await waitForResponse(workerScope, 2);

        expect(response.ok).toBe(true);
        expect(generations.get('legacy.md')).toMatch(/^peg1-[0-9a-f]{32}$/);
        if (!response.ok) return;
        expect(response.result).toMatchObject({
            paths: [{
                path: 'legacy.md',
                pathEvidenceGeneration: generations.get('legacy.md'),
            }],
        });
    });

    it('aborts a standalone legacy repair at its next checkpoint and releases the Worker queue', async () => {
        const rows = [
            graphRow(1, 'legacy-a.md', 0, [1, 0]),
            graphRow(2, 'legacy-b.md', 0, [0, 1]),
        ];
        const generations = new Map<string, string>();
        let workerScope!: MockWorkerScope;
        let updateCount = 0;
        ({ workerScope } = await setupGraphRankingWorker(rows, '7', generations, {
            onLegacyGenerationUpdated: () => {
                updateCount += 1;
                if (updateCount !== 1) return;
                dispatch(workerScope, {
                    type: 'cancelPathEvidenceGeneration',
                    payload: { requestId: 'path-evidence-2', runEpoch: 'run-1' },
                });
                dispatch(workerScope, {
                    id: 3,
                    type: 'getFileRecord',
                    payload: { path: 'legacy-a.md' },
                });
            },
        }));

        dispatch(workerScope, pathEvidenceRequest(2, ['legacy-a.md', 'legacy-b.md']));
        const cancelled = await waitForResponse(workerScope, 2);
        const foreground = await waitForResponse(workerScope, 3);

        expect(cancelled).toMatchObject({
            ok: false,
            error: { code: 'path-evidence-aborted' },
        });
        expect(foreground).toMatchObject({
            ok: true,
            result: expect.objectContaining({ path: 'legacy-a.md' }),
        });
        expect(updateCount).toBe(1);
        expect(generations).toHaveProperty('size', 0);
        const responseIds = workerScope.postMessage.mock.calls
            .map((call) => call[0].id)
            .filter((id) => id === 2 || id === 3);
        expect(responseIds).toEqual([2, 3]);
    });

    it('stops a standalone legacy repair when the shared absolute deadline elapses', async () => {
        let now = 1_000;
        const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
        try {
            const rows = [
                graphRow(1, 'legacy-a.md', 0, [1, 0]),
                graphRow(2, 'legacy-b.md', 0, [0, 1]),
            ];
            const generations = new Map<string, string>();
            let updateCount = 0;
            const { workerScope } = await setupGraphRankingWorker(rows, '7', generations, {
                onLegacyGenerationUpdated: () => {
                    updateCount += 1;
                    now = 1_001;
                },
            });

            dispatch(workerScope, pathEvidenceRequest(
                2,
                ['legacy-a.md', 'legacy-b.md'],
                { absoluteDeadlineMs: 1_001 },
            ));
            const response = await waitForResponse(workerScope, 2);

            expect(response).toMatchObject({
                ok: false,
                error: { code: 'path-evidence-deadline' },
            });
            expect(updateCount).toBe(1);
            expect(generations).toHaveProperty('size', 0);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('does not repair a legacy generation when graph row preflight exceeds the request budget', async () => {
        const rows = [
            graphRow(1, 'legacy.md', 0, [1, 0]),
            graphRow(2, 'legacy.md', 1, [0.8, 0.2]),
        ];
        const generations = new Map<string, string>();
        const { workerScope } = await setupGraphRankingWorker(rows, '7', generations);

        dispatch(workerScope, graphRankRequest(2, ['legacy.md'], '7', { maxChunksScanned: 1 }));
        const response = await waitForResponse(workerScope, 2);

        expect(response).toMatchObject({
            ok: false,
            error: { code: 'graph-rank-budget-exceeded' },
        });
        expect(generations).toHaveProperty('size', 0);
    });

    it('observes a queued cancel before the next graph ranking message continuation', async () => {
        const rows = Array.from({ length: 300 }, (_, index) => graphRow(index + 1, 'a.md', index, [1, 0]));
        const { workerScope } = await setupGraphRankingWorker(rows, '7');
        await queueWorkerMessages(workerScope, [
            graphRankRequest(2, ['a.md'], '7', { maxChunksScanned: 400 }),
            {
                type: 'cancelGraphRank',
                payload: { requestId: 'rank-2', runEpoch: 'run-1' },
            },
        ]);
        const response = await waitForResponse(workerScope, 2);
        expect(response).toMatchObject({
            ok: false,
            error: { code: 'graph-rank-aborted' },
        });
    });

    it('rejects a rank queued behind a vector write instead of echoing a stale caller epoch', async () => {
        const { workerScope } = await setupGraphRankingWorker([graphRow(1, 'a.md', 0, [1, 0])], '7');
        dispatch(workerScope, {
            id: 2,
            type: 'deleteFile',
            payload: { path: 'a.md' },
        });
        dispatch(workerScope, graphRankRequest(3, ['a.md'], '7'));
        const deleteResponse = await waitForResponse(workerScope, 2);
        const rankResponse = await waitForResponse(workerScope, 3);
        expect(deleteResponse.ok).toBe(true);
        expect(rankResponse).toMatchObject({
            ok: false,
            error: { code: 'graph-rank-source-epoch-mismatch' },
        });
    });

    it.each([
        [{ allowedPaths: ['allowed.md', 'excluded.md'], excludedPaths: ['excluded.md'] }, ['allowed.md']],
        [{ allowedPaths: null, excludedPaths: ['excluded.md', 'outside.md'] }, ['allowed.md']],
        [{ allowedPaths: [], excludedPaths: [] }, []],
    ])('filters host note scope before vector Top-1: %j', async (noteScope, expectedPaths) => {
        const { workerScope, sqlRequests } = await setupGraphRankingWorker([
            graphRow(1, 'outside.md', 0, [1, 0]),
            graphRow(2, 'excluded.md', 0, [1, 0.01]),
            graphRow(3, 'allowed.md', 0, [1, 0.5]),
        ], '7');
        dispatch(workerScope, {
            id: 2,
            type: 'searchHybrid',
            payload: {
                queryEmbedding: [1, 0], ftsQuery: null, k: 1, fusionTopK: 1,
                lexicalSkipReason: 'feature_disabled', noteScope,
            },
        });
        const response = await waitForResponse(workerScope, 2);
        expect(response.ok).toBe(true);
        if (!response.ok) throw new Error('Scoped worker query failed.');
        const result = response.result as import('../src/vss/types').VectorHybridSearchResult;
        expect(result.results.map((entry) => entry.doc.metadata.path)).toEqual(expectedPaths);
        expect(sqlRequests.some((query) => query.sql.trim() === 'SELECT id, embedding FROM vss_chunks')).toBe(false);
        expect(sqlRequests.some((query) => query.sql.includes('SELECT id, embedding FROM vss_chunks WHERE'))).toBe(true);
    });

    it('binds the same note scope before lexical ORDER BY and LIMIT', async () => {
        const { workerScope, sqlRequests } = await setupGraphRankingWorker([], '7', new Map(), { lexical: true });
        dispatch(workerScope, {
            id: 2, type: 'searchHybrid', payload: {
                queryEmbedding: [1, 0], ftsQuery: '"topic"', k: 1, fusionTopK: 1,
                lexicalBoundaryFingerprint: 'scope-test',
                noteScope: { allowedPaths: ['allowed.md', 'excluded.md'], excludedPaths: ['excluded.md'] },
            },
        });
        const response = await waitForResponse(workerScope, 2);
        expect(response).toMatchObject({ ok: true, result: { lexical: { attempted: true } } });
        const query = sqlRequests.find((entry) => entry.sql.includes(' MATCH ?'));
        expect(query).toBeDefined();
        expect(query!.sql.indexOf('AND c.path IN (SELECT value FROM json_each(?))'))
            .toBeLessThan(query!.sql.indexOf('ORDER BY'));
        expect(query!.sql.indexOf('AND c.path NOT IN (SELECT value FROM json_each(?))'))
            .toBeLessThan(query!.sql.indexOf('LIMIT ?'));
        expect(query!.bind?.slice(0, 3)).toEqual([
            '"topic"', '["allowed.md","excluded.md"]', '["excluded.md"]',
        ]);
        // Execute the worker-generated query against the installed SQLite/WASM,
        // not a fake SQL evaluator, including FTS ranking and its one-row cap.
        const { stdout: actualPaths } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
            import init from '@sqlite.org/sqlite-wasm';
            const query = JSON.parse(process.argv[1]);
            const sqlite = await init();
            const db = new sqlite.oo1.DB(':memory:');
            const table = query.sql.match(/FROM\\s+(\\w+)/)[1];
            db.exec('CREATE TABLE vss_chunks(id INTEGER, path TEXT, chunk_index INTEGER, content TEXT, metadata TEXT, last_modified INTEGER)');
            db.exec('CREATE TABLE vss_files(path TEXT, evidence_generation TEXT)');
            db.exec('CREATE VIRTUAL TABLE ' + table + ' USING fts5(title, heading, body, path)');
            for (const [index, path] of ['outside.md', 'excluded.md', 'allowed.md'].entries()) {
                db.exec({sql: 'INSERT INTO vss_chunks VALUES(?, ?, 0, ?, ?, 100)', bind: [index + 1, path, 'topic', '{}']});
                db.exec({sql: 'INSERT INTO vss_files VALUES(?, ?)', bind: [path, 'generation']});
                db.exec({sql: 'INSERT INTO ' + table + '(rowid,title,heading,body,path) VALUES(?, ?, ?, ?, ?)', bind: [index + 1, 'topic', '', index === 2 ? 'topic other words' : 'topic topic topic', path]});
            }
            const paths = db.exec({sql: query.sql, bind: query.bind, rowMode: 'object', returnValue: 'resultRows'}).map(row => row.path);
            db.close();
            process.stdout.write(JSON.stringify(paths));
        `, JSON.stringify(query)], { encoding: 'utf8' });
        expect(JSON.parse(actualPaths)).toEqual(['allowed.md']);
    });

    it('removes unchanged generations before vector Top-12 so repeats do not occupy seats', async () => {
        const rows = Array.from({ length: 15 }, (_, index) => (
            graphRow(index + 1, `p${index.toString().padStart(2, '0')}.md`, 0, [1, index / 100])
        ));
        const generations = new Map(rows.map((row) => [row.path, `generation-${row.path}`]));
        const { workerScope } = await setupGraphRankingWorker(rows, '7', generations);
        dispatch(workerScope, {
            id: 2,
            type: 'searchHybrid',
            payload: {
                queryEmbedding: [1, 0],
                ftsQuery: null,
                k: 12,
                fusionTopK: 12,
                lexicalSkipReason: 'feature_disabled',
                excludedPathGenerations: ['p00.md', 'p01.md', 'p02.md'].map((path) => ({
                    path,
                    generation: generations.get(path)!,
                })),
            },
        });
        const response = await waitForResponse(workerScope, 2);
        expect(response.ok).toBe(true);
        if (!response.ok) return;
        const result = response.result as {
            results: Array<{ doc: { metadata: Record<string, unknown> } }>;
        };
        expect(result.results).toHaveLength(12);
        expect(result.results.map((entry) => entry.doc.metadata.path)).toEqual(
            Array.from({ length: 12 }, (_, index) => `p${(index + 3).toString().padStart(2, '0')}.md`),
        );
        expect(result.results[0].doc.metadata.pathEvidenceGeneration).toBe('generation-p03.md');
    });
});

async function send(scope: MockWorkerScope, request: SqliteWorkerRequest): Promise<SqliteWorkerResponse> {
    dispatch(scope, request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return scope.postMessage.mock.calls.at(-1)?.[0] as SqliteWorkerResponse;
}

function notFoundError(): Error {
    const error = new Error('not found');
    error.name = 'NotFoundError';
    return error;
}

function opaqueFile(path: string, data = new Uint8Array([1, 2, 3]), v2 = false): Uint8Array {
    const bytes = new Uint8Array(4096 + data.length);
    bytes.set(new TextEncoder().encode(path));
    new DataView(bytes.buffer).setUint32(512, path ? (v2 ? 0x180 : 0x100) : 0);
    if (v2) {
        // Canonical 3.53.0 SAH digest for /memory.sqlite3 with flags 0x180.
        // Keep a fixed physical fixture instead of copying the production hash function.
        if (path !== '/memory.sqlite3') throw new Error('V2 fixture has a fixed path');
        bytes.set([219, 230, 50, 104, 27, 215, 249, 217], 516);
    }
    bytes.set(data, 4096);
    return bytes;
}

async function setupStorageInspectionWorker(contents: Uint8Array[], signature: string | null = 'old-profile') {
    const handles = contents.map(bytes => ({
        getSize: () => bytes.length,
        read: jest.fn((buffer: Uint8Array, { at }: { at: number }) => {
            const source = bytes.subarray(at, at + buffer.length);
            buffer.set(source);
            return source.length;
        }),
        close: jest.fn(),
        write: jest.fn(() => { throw new Error('probe attempted a write'); }),
        truncate: jest.fn(() => { throw new Error('probe attempted a truncate'); }),
    }));
    const files = handles.map(handle => ({
        kind: 'file',
        createSyncAccessHandle: jest.fn(async (_options: { mode: string }) => handle),
    }));
    const opaque = {
        kind: 'directory',
        async *entries() { for (const [index, file] of files.entries()) yield [`slot-${index}`, file]; },
    };
    const store = { getDirectoryHandle: jest.fn(async (name: string, options?: { create?: boolean }) => {
        if (options?.create || name !== '.opaque') throw new Error('unexpected storage creation');
        return opaque;
    }) };
    const root = {
        getDirectoryHandle: jest.fn(async (name: string, options?: { create?: boolean }) => {
            if (options?.create || name !== 'owned') throw new Error('unexpected directory access');
            return store;
        }),
        removeEntry: jest.fn(async (_name: string, _options?: { recursive?: boolean }) => undefined),
    };
    let memory = new Uint8Array(64);
    const alloc = jest.fn((size: number) => { memory = new Uint8Array(size + 32); return 32; });
    const dealloc = jest.fn((_pointer: number) => undefined);
    const deserialize = jest.fn((_database: number, _schema: string, _pointer: number,
        _databaseSize: number, _bufferSize: number, _flags: number) => 0);
    const database = {
        pointer: 16,
        close: jest.fn(),
        exec: jest.fn((request: unknown) => {
            const query = request as { resultRows?: unknown[] };
            if (signature !== null) query.resultRows?.push({ value: signature });
        }),
    };
    class MemoryDb { constructor(_filename: string) { return database; } }
    const installPool = jest.fn<() => Promise<unknown>>(async () => { throw new Error('probe must not install a pool'); });
    const init = jest.fn(async () => ({
        oo1: { DB: MemoryDb },
        capi: { SQLITE_DESERIALIZE_READONLY: 4, sqlite3_deserialize: deserialize },
        wasm: { alloc, dealloc, heap8u: () => memory },
        installOpfsSAHPoolVfs: installPool,
    }));
    const scope: MockWorkerScope & { navigator: unknown } = {
        crypto: globalThis.crypto,
        postMessage: jest.fn(),
        navigator: { storage: { getDirectory: async () => root } },
    };
    Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
    jest.doMock('@sqlite.org/sqlite-wasm', () => ({ __esModule: true, default: init }));
    await import('../src/vss/sqlite-worker');
    return { scope, root, files, handles, database, alloc, dealloc, deserialize, installPool, init };
}

function dispatch(scope: MockWorkerScope, request: SqliteWorkerMessage): void {
    scope.onmessage?.({ data: request } as MessageEvent<SqliteWorkerMessage>);
}

async function queueWorkerMessages(
    scope: MockWorkerScope,
    requests: readonly SqliteWorkerMessage[],
): Promise<void> {
    if (requests.length === 0) return;
    const channel = new MessageChannel();
    await new Promise<void>((resolve) => {
        let delivered = 0;
        channel.port1.onmessage = (event: MessageEvent<SqliteWorkerMessage>) => {
            dispatch(scope, event.data);
            delivered += 1;
            if (delivered !== requests.length) return;
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        for (const request of requests) channel.port2.postMessage(request);
    });
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

function isPragmaTableInfoQuery(request: unknown): boolean {
    return Boolean(
        request
        && typeof request === 'object'
        && 'sql' in request
        && typeof (request as { sql?: unknown }).sql === 'string'
        && (request as { sql: string }).sql.includes('pragma_table_info'),
    );
}

function isExecRowsRequest(request: unknown): request is { rowMode: string; resultRows: unknown[][] } {
    return Boolean(
        request
        && typeof request === 'object'
        && 'resultRows' in request
        && Array.isArray((request as { resultRows?: unknown }).resultRows),
    );
}

interface GraphMockRow {
    id: number;
    path: string;
    chunk_index: number;
    content: string;
    metadata: string;
    embedding: Uint8Array;
    content_hash: string;
    created: number;
    last_modified: number;
}

function graphRow(id: number, path: string, chunkIndex: number, embedding: number[]): GraphMockRow {
    const vector = new Float32Array(embedding);
    return {
        id,
        path,
        chunk_index: chunkIndex,
        content: `${path}:${chunkIndex}`,
        metadata: JSON.stringify({ path, chunkIndex }),
        embedding: new Uint8Array(vector.buffer),
        content_hash: `chunk-${id}`,
        created: 1,
        last_modified: 100,
    };
}

function graphRankRequest(
    id: number,
    paths: string[],
    sourceEpoch: string,
    overrides: { maxChunksScanned?: number } = {},
): Extract<SqliteWorkerRequest, { type: 'rankGraphCandidates' }> {
    return {
        id,
        type: 'rankGraphCandidates',
        payload: {
            queryEmbedding: [1, 0],
            paths,
            control: {
                requestId: `rank-${id}`,
                runEpoch: 'run-1',
                sourceEpoch,
                absoluteDeadlineMs: Date.now() + 10_000,
                maxPathsPerBatch: 2,
                maxCandidatePaths: 10,
                maxChunksScanned: overrides.maxChunksScanned ?? 100,
            },
        },
    };
}

function pathEvidenceRequest(
    id: number,
    paths: string[],
    overrides: { absoluteDeadlineMs?: number } = {},
): Extract<SqliteWorkerRequest, { type: 'getPathEvidenceGenerations' }> {
    return {
        id,
        type: 'getPathEvidenceGenerations',
        payload: {
            paths,
            maxPathsPerBatch: 2,
            maxChunksScanned: 100,
            control: {
                requestId: `path-evidence-${id}`,
                runEpoch: 'run-1',
                absoluteDeadlineMs: overrides.absoluteDeadlineMs ?? Date.now() + 10_000,
            },
        },
    };
}

async function setupGraphRankingWorker(
    rows: GraphMockRow[],
    initialEpoch: string,
    generations = new Map(rows.map((row) => [row.path, `generation-${row.path}`])),
    options: { onLegacyGenerationUpdated?: (path: string) => void; lexical?: boolean } = {},
): Promise<{
    workerScope: MockWorkerScope;
    meta: Map<string, string>;
    generations: Map<string, string>;
    sqlRequests: Array<{ sql: string; bind?: unknown[] }>;
}> {
    const sqlRequests: Array<{ sql: string; bind?: unknown[] }> = [];
    const meta = new Map<string, string>([['chunkMutationEpoch', initialEpoch]]);
    let transactionGenerations: Map<string, string> | null = null;
    const db = {
        close: jest.fn(),
        exec: jest.fn((request: unknown) => {
            if (typeof request === 'string') {
                const statement = request.trim();
                if (statement === 'BEGIN') {
                    transactionGenerations = new Map(generations);
                } else if (statement === 'ROLLBACK' && transactionGenerations) {
                    generations.clear();
                    for (const [path, generation] of transactionGenerations) {
                        generations.set(path, generation);
                    }
                    transactionGenerations = null;
                } else if (statement === 'COMMIT') {
                    transactionGenerations = null;
                }
                return;
            }
            if (!request || typeof request !== 'object' || !('sql' in request)) return;
            const query = request as {
                sql: string;
                bind?: unknown[];
                rowMode?: string;
                resultRows?: unknown[];
            };
            sqlRequests.push(query);
            if (
                query.sql.includes("pragma_table_info('vss_chunks')")
                || query.sql.includes("pragma_table_info('vss_files')")
            ) {
                query.resultRows?.push([1]);
                return;
            }
            if (query.sql.includes('SELECT value FROM vss_meta')) {
                const value = meta.get(String(query.bind?.[0]));
                if (value !== undefined) query.resultRows?.push({ value });
                return;
            }
            if (query.sql.includes('INSERT OR REPLACE INTO vss_meta')) {
                meta.set(String(query.bind?.[0]), String(query.bind?.[1]));
                return;
            }
            if (query.sql.includes('AS file_exists') && query.sql.includes('AS chunk_exists')) {
                const filePath = String(query.bind?.[0]);
                const chunkPath = String(query.bind?.[1]);
                query.resultRows?.push([
                    generations.has(filePath) ? 1 : 0,
                    rows.some((row) => row.path === chunkPath) ? 1 : 0,
                ]);
                return;
            }
            if (query.sql.includes('COUNT(*) AS chunk_count') && query.sql.includes('inventory_bytes')) {
                const allowed = new Set((query.bind ?? []).map(String));
                const counts = new Map<string, { count: number; bytes: number }>();
                for (const row of rows) {
                    if (!allowed.has(row.path)) continue;
                    const current = counts.get(row.path) ?? { count: 0, bytes: 0 };
                    current.count += 1;
                    current.bytes += new TextEncoder().encode(
                        `${row.path}${row.content}${row.metadata}${row.content_hash}`,
                    ).byteLength + 64;
                    counts.set(row.path, current);
                }
                for (const path of [...counts.keys()].sort()) {
                    const current = counts.get(path)!;
                    query.resultRows?.push({
                        path,
                        chunk_count: current.count,
                        inventory_bytes: current.bytes,
                    });
                }
                return;
            }
            if (query.sql.includes('SELECT path, COUNT(*) AS chunk_count')) {
                const allowed = new Set((query.bind ?? []).map(String));
                const counts = new Map<string, number>();
                for (const row of rows) {
                    if (allowed.has(row.path)) counts.set(row.path, (counts.get(row.path) ?? 0) + 1);
                }
                for (const path of [...counts.keys()].sort()) {
                    query.resultRows?.push({ path, chunk_count: counts.get(path) });
                }
                return;
            }
            if (query.sql.includes('SELECT path, evidence_generation, content_hash, mtime, size')) {
                const allowed = new Set((query.bind ?? []).map(String));
                for (const path of [...allowed].sort()) {
                    if (!rows.some((row) => row.path === path)) continue;
                    query.resultRows?.push({
                        path,
                        evidence_generation: generations.get(path) ?? '',
                        content_hash: `content-${path}`,
                        mtime: 100,
                        size: 200,
                    });
                }
                return;
            }
            if (query.sql.includes('SELECT path, chunk_index, content, content_hash, created, last_modified, metadata')) {
                const path = String(query.bind?.[0]);
                query.resultRows?.push(...rows
                    .filter((row) => row.path === path)
                    .sort((left, right) => left.chunk_index - right.chunk_index));
                return;
            }
            if (query.sql.includes('UPDATE vss_files') && query.sql.includes('SET evidence_generation = ?')) {
                const [generation, path] = query.bind ?? [];
                if (!generations.get(String(path))) {
                    generations.set(String(path), String(generation));
                    options.onLegacyGenerationUpdated?.(String(path));
                }
                return;
            }
            if (query.sql.includes('SELECT evidence_generation') && query.sql.includes('FROM vss_files')) {
                const generation = generations.get(String(query.bind?.[0]));
                if (generation) query.resultRows?.push({ evidence_generation: generation });
                return;
            }
            if (query.sql.includes('content_hash AS contentHash') && query.sql.includes('FROM vss_files')) {
                const path = String(query.bind?.[0]);
                if (!rows.some((row) => row.path === path)) return;
                query.resultRows?.push({
                    path,
                    contentHash: `content-${path}`,
                    mtime: 100,
                    size: 200,
                    status: 'ready',
                    updatedAt: 1,
                });
                return;
            }
            if (query.sql.trim() === 'SELECT id, embedding FROM vss_chunks') {
                for (const row of rows) query.resultRows?.push([row.id, row.embedding]);
                return;
            }
            if ((query.sql.includes('SELECT id FROM vss_chunks')
                || query.sql.includes('SELECT id, embedding FROM vss_chunks WHERE')) && query.sql.includes('WHERE 1=1')) {
                const binds = [...(query.bind ?? [])];
                const allowedPaths = query.sql.includes('AND path IN (SELECT value FROM json_each(?))')
                    ? new Set<string>(JSON.parse(String(binds.shift()))) : null;
                const scopeExcluded = query.sql.includes('AND path NOT IN (SELECT value FROM json_each(?))')
                    ? new Set<string>(JSON.parse(String(binds.shift()))) : new Set<string>();
                const excludedPaths = new Set(binds.map(String));
                for (const row of rows) {
                    if ((!allowedPaths || allowedPaths.has(row.path))
                        && !scopeExcluded.has(row.path) && !excludedPaths.has(row.path)) {
                        query.resultRows?.push(query.rowMode === 'array' ? [row.id, row.embedding] : { id: row.id });
                    }
                }
                return;
            }
            if (query.sql.includes('SELECT c.id, c.path, c.chunk_index, c.content, c.metadata, f.evidence_generation')) {
                const allowedIds = new Set((query.bind ?? []).map(Number));
                for (const row of rows) {
                    if (!allowedIds.has(row.id)) continue;
                    query.resultRows?.push({
                        ...row,
                        evidence_generation: generations.get(row.path) ?? '',
                    });
                }
                return;
            }
            if (query.sql.includes('SELECT id, path, chunk_index, content, metadata, embedding')) {
                const bind = query.bind ?? [];
                const allowed = new Set(bind.slice(0, -2).map(String));
                const afterRowId = Number(bind.at(-2));
                const limit = Number(bind.at(-1));
                query.resultRows?.push(...rows
                    .filter((row) => allowed.has(row.path) && row.id > afterRowId)
                    .sort((left, right) => left.id - right.id)
                    .slice(0, limit));
                return;
            }
            if (query.sql.includes('DELETE FROM vss_chunks WHERE path = ?')) {
                const path = String(query.bind?.[0]);
                for (let index = rows.length - 1; index >= 0; index -= 1) {
                    if (rows[index].path === path) rows.splice(index, 1);
                }
            }
        }),
    };
    class MockDb {
        constructor() {
            return db;
        }
    }
    const workerScope: MockWorkerScope = { crypto: globalThis.crypto, postMessage: jest.fn() };
    Object.defineProperty(globalThis, 'self', { configurable: true, value: workerScope });
    jest.doMock('@sqlite.org/sqlite-wasm', () => ({
        __esModule: true,
        default: jest.fn(async () => ({
            capi: { sqlite3_progress_handler: jest.fn() },
            installOpfsSAHPoolVfs: async () => ({
                OpfsSAHPoolDb: MockDb,
                pauseVfs: jest.fn(),
            }),
        })),
    }));
    await import('../src/vss/sqlite-worker');
    const initialized = await send(workerScope, {
        id: 1,
        type: 'initialize',
        payload: {
            profile: {
                provider: 'openai',
                baseURL: '',
                model: 'model',
                dimensions: 2,
                distanceMetric: 'COSINE',
            },
            databaseName: 'graph-ranking.sqlite3',
            wasmUrl: 'blob:sqlite-wasm',
            lexicalProfileEnabled: options.lexical,
            lexicalBoundaryFingerprint: 'scope-test',
        },
    });
    expect(initialized.ok).toBe(true);
    return { workerScope, meta, generations, sqlRequests };
}

async function waitForResponse(scope: MockWorkerScope, id: number): Promise<SqliteWorkerResponse> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = scope.postMessage.mock.calls
            .map((call) => call[0])
            .find((candidate) => candidate.id === id);
        if (response) return response;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Worker response ${id} was not posted.`);
}
