import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { VSS } from '../src/vss';
import { computeContentHash, DirtyTimestamps } from '../src/vss-helpers';
import { TFile } from 'obsidian';
import { Document } from '@langchain/core/documents';
import { VSS_SCHEMA_VERSION, type EmbeddingProfile, type IndexedPathEvidenceGenerationResult, type LexicalIndexStatus, type LexicalRebuildBatchResult, type RankGraphCandidatesOptions, type RankedPathRequestControl, type RankedPathRequestResult, type VectorIndex, type VectorIndexDeleteOptions, type VectorIndexStatus, type VectorSearchResult, type VSSChunk, type VSSFileRecord, type VSSFileState, type VSSIndexMarker, type VSSIndexStats } from '../src/vss/types';
import { fuseRRF, RRF_K } from '../src/vss/rrf';
import { MemoryVSSIndexStateStore } from '../src/vss/local-state-store';
import { getVSSDeviceId } from '../src/vss/state';
import { RETRIEVAL_CALIBRATION_PROFILE } from '../src/vss/retrieval-calibration';

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
        Platform: { isMobile: false, isWin: false },
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

jest.mock('../src/confirm', () => ({
    confirmUserAction: jest.fn(async () => true),
}));

const MockSqliteVectorIndex = (jest.requireMock('../src/vss/sqlite-vector-index') as { SqliteVectorIndex: jest.Mock }).SqliteVectorIndex;
const mockConfirmUserAction = (jest.requireMock('../src/confirm') as { confirmUserAction: jest.Mock }).confirmUserAction;
const mockPlatform = (jest.requireMock('obsidian') as {
    Platform: { isMobile: boolean; isWin: boolean };
}).Platform;

class FakeVectorIndex implements VectorIndex {
    status: VectorIndexStatus = 'ready';
    records = new Map<string, VSSFileRecord>();
    deleteFile = jest.fn<(path: string, options?: VectorIndexDeleteOptions) => Promise<void>>(async (path, _options) => {
        this.records.delete(path);
    });
    listFilePaths = jest.fn<() => Promise<string[]>>(async () => Array.from(this.records.keys()).sort());
    listFileRecords = jest.fn<() => Promise<VSSFileRecord[]>>(async () => Array.from(this.records.values()).sort((left, right) => left.path.localeCompare(right.path)));
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
    updateFileMetadata = jest.fn<(fileState: VSSFileState) => Promise<void>>(async (fileState) => {
        const existing = this.records.get(fileState.path);
        if (!existing) return;
        this.records.set(fileState.path, {
            ...existing,
            contentHash: fileState.contentHash,
            mtime: fileState.mtime,
            size: fileState.size,
            updatedAt: Date.now(),
        });
    });
    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => this.status);
    search = jest.fn<(queryEmbedding: number[], k: number) => Promise<VectorSearchResult[]>>(async () => []);
    getChunksByPath = jest.fn<VectorIndex["getChunksByPath"]>(async () => []);
    getFileRecord = jest.fn<(path: string) => Promise<VSSFileRecord | null>>(async (path) => this.records.get(path) ?? null);
    getStats = jest.fn<() => Promise<VSSIndexStats>>(async () => ({
        status: this.status,
        backend: 'sqlite-wasm-opfs-sahpool',
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

class FakeLexicalVectorIndex extends FakeVectorIndex {
    lexicalStatus: LexicalIndexStatus = {
        state: 'awaiting_confirmation',
        reason: 'profile_missing',
        chunkCount: 2,
        lexicalRowCount: 0,
    };
    private processedRows = 0;
    private firstBatchRelease: (() => void) | null = null;
    private firstBatchStarted: (() => void) | null = null;
    private firstBatchStartedPromise: Promise<void> | null = null;
    private expectedScopePaths = 0;
    private acceptedScopePaths = 0;
    blockFirstBatch = false;
    operationOrder: string[] = [];

    getLexicalStatus = jest.fn(async () => this.lexicalStatus);
    searchHybridDetailed = jest.fn(async () => ({
        results: [] as VectorSearchResult[],
        sourceEpoch: '7',
        lexical: {
            attempted: false,
            state: this.lexicalStatus.state,
            reason: this.lexicalStatus.reason,
        },
    }));
    getStats = jest.fn<() => Promise<VSSIndexStats>>(async () => ({
        status: this.status,
        backend: 'sqlite-wasm-opfs-sahpool',
        chunkCount: this.records.size,
        fileCount: this.records.size,
        fallbackMode: false,
        lexicalProfileState: this.lexicalStatus.state,
        lexicalProfileId: this.lexicalStatus.marker?.profileId,
        lexicalGeneration: this.lexicalStatus.marker?.generation,
        lexicalFallbackReason: this.lexicalStatus.reason,
    }));
    beginLexicalRebuild = jest.fn(async (
        _profileId?: string,
        _fingerprint?: string,
        _scopeFingerprint?: string,
        expectedPathCount?: number,
    ) => {
        this.processedRows = 0;
        this.expectedScopePaths = expectedPathCount ?? 0;
        this.acceptedScopePaths = 0;
        this.lexicalStatus = { ...this.lexicalStatus, state: 'rebuilding', reason: undefined };
        return { rebuildId: 'lexical-1', generation: 1, sourceChunkEpoch: '7', totalRows: 2 };
    });
    appendLexicalScopeBatch = jest.fn(async (rebuildId: string, paths: string[]) => {
        this.acceptedScopePaths += paths.length;
        return {
            rebuildId,
            acceptedPaths: this.acceptedScopePaths,
            expectedPaths: this.expectedScopePaths,
            sealed: this.acceptedScopePaths === this.expectedScopePaths,
            totalRows: this.acceptedScopePaths === this.expectedScopePaths ? 2 : 0,
        };
    });
    appendLexicalRebuildBatch = jest.fn(async (
        rebuildId: string,
        _afterRowId: number,
        _limit: number,
    ): Promise<LexicalRebuildBatchResult> => {
        this.operationOrder.push(`append-${this.processedRows + 1}`);
        if (this.blockFirstBatch && this.processedRows === 0) {
            this.firstBatchStarted?.();
            await new Promise<void>((resolve) => {
                this.firstBatchRelease = resolve;
            });
        }
        this.processedRows += 1;
        return {
            rebuildId,
            processedRows: this.processedRows,
            totalRows: 2,
            nextRowId: this.processedRows,
            done: this.processedRows >= 2,
        };
    });
    finalizeLexicalRebuild = jest.fn(async () => {
        this.lexicalStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 2,
            lexicalRowCount: 2,
        };
        return this.lexicalStatus;
    });
    abortLexicalRebuild = jest.fn(async () => {
        this.lexicalStatus = {
            state: 'awaiting_confirmation',
            reason: 'rebuild_aborted',
            chunkCount: 2,
            lexicalRowCount: 0,
        };
        return this.lexicalStatus;
    });

    waitForFirstBatch(): Promise<void> {
        this.firstBatchStartedPromise ??= new Promise((resolve) => {
            this.firstBatchStarted = resolve;
        });
        return this.firstBatchStartedPromise;
    }

    releaseFirstBatch(): void {
        this.firstBatchRelease?.();
    }
}

class FailingVectorIndex extends FakeVectorIndex {
    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => {
        throw new Error('opfs unavailable');
    });
}

class LockedVectorIndex extends FakeVectorIndex {
    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => {
        throw Object.assign(new Error('Local memory storage is busy'), { code: 'opfs-sahpool-locked' });
    });
}

class DelayedDirtyStateStore extends MemoryVSSIndexStateStore {
    private releaseWrite: (() => void) | null = null;
    private writeScheduled: Promise<void> | null = null;
    private resolveWriteScheduled: (() => void) | null = null;

    async setDirtyJournal(dirty: Map<string, DirtyTimestamps>): Promise<void> {
        this.writeScheduled = new Promise((resolve) => {
            this.resolveWriteScheduled = resolve;
        });
        this.resolveWriteScheduled?.();
        await new Promise<void>((resolve) => {
            this.releaseWrite = resolve;
        });
        await super.setDirtyJournal(dirty);
    }

    async waitForWriteScheduled(): Promise<void> {
        while (!this.writeScheduled) {
            await Promise.resolve();
        }
        await this.writeScheduled;
    }

    release(): void {
        this.releaseWrite?.();
    }
}

class FailingClearStateStore extends MemoryVSSIndexStateStore {
    failNextClear = true;

    async removeMarker(): Promise<void> {
        if (this.failNextClear) {
            this.failNextClear = false;
            throw new Error('clear blocked once');
        }
        await super.removeMarker();
    }
}

class FailingDirtyWriteOnceStateStore extends MemoryVSSIndexStateStore {
    initializeCalls = 0;
    failNextDirtyWrite = true;

    async initialize(): Promise<void> {
        this.initializeCalls++;
        await super.initialize();
    }

    async setDirtyJournal(dirty: Map<string, DirtyTimestamps>): Promise<void> {
        if (this.failNextDirtyWrite) {
            this.failNextDirtyWrite = false;
            throw new Error('dirty write failed once');
        }
        await super.setDirtyJournal(dirty);
    }
}

class FailingOnceStateStore extends MemoryVSSIndexStateStore {
    initializeCalls = 0;

    async initialize(): Promise<void> {
        this.initializeCalls++;
        if (this.initializeCalls === 1) {
            throw new Error('indexeddb blocked once');
        }
        await super.initialize();
    }
}

class BlockingStatsVectorIndex extends FakeVectorIndex {
    private releaseStats: (() => void) | null = null;
    private statsStarted: Promise<void> | null = null;
    private resolveStatsStarted: (() => void) | null = null;

    getStats = jest.fn<() => Promise<VSSIndexStats>>(async () => {
        this.statsStarted = new Promise((resolve) => {
            this.resolveStatsStarted = resolve;
        });
        this.resolveStatsStarted?.();
        await new Promise<void>((resolve) => {
            this.releaseStats = resolve;
        });
        return {
            status: this.status,
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: this.records.size,
            fileCount: this.records.size,
            fallbackMode: false,
        };
    });

    async waitForStatsStarted(): Promise<void> {
        while (!this.statsStarted) {
            await Promise.resolve();
        }
        await this.statsStarted;
    }

    release(): void {
        this.releaseStats?.();
    }
}

class BlockingInitializeVectorIndex extends FakeVectorIndex {
    private releaseInitialize: (() => void) | null = null;
    private initializeStarted: Promise<void> | null = null;
    private resolveInitializeStarted: (() => void) | null = null;

    initialize = jest.fn<(profile: EmbeddingProfile) => Promise<VectorIndexStatus>>(async () => {
        this.initializeStarted = new Promise((resolve) => {
            this.resolveInitializeStarted = resolve;
        });
        this.resolveInitializeStarted?.();
        await new Promise<void>((resolve) => {
            this.releaseInitialize = resolve;
        });
        return this.status;
    });

    async waitForInitializeStarted(): Promise<void> {
        while (!this.initializeStarted) {
            await Promise.resolve();
        }
        await this.initializeStarted;
    }

    release(): void {
        this.releaseInitialize?.();
    }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const createMissingFileError = (): NodeJS.ErrnoException => {
    const enoent = new Error('missing') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    return enoent;
};

const createPlugin = (overrides: Record<string, unknown> = {}) => {
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
        read: jest.fn<(file: TFile) => Promise<string>>(async (file) => mockAdapter.read(file.path)),
    };

    const plugin: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
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
        ...overrides,
    };

    return { plugin, mockAdapter, mockVault, vssStateStore };
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

function createReadyMarker(overrides: Partial<VSSIndexMarker> = {}): VSSIndexMarker {
    return {
        schemaVersion: VSS_SCHEMA_VERSION,
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
    (vss as any).localStateReady = true; // eslint-disable-line @typescript-eslint/no-explicit-any
    (vss as any).marker = createReadyMarker({ // eslint-disable-line @typescript-eslint/no-explicit-any
        deviceId: 'device-1',
        chunkCount: index.records.size,
        fileCount: index.records.size,
    });
}

describe('VSS SQLite/WASM lifecycle', () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalConfirm = Object.getOwnPropertyDescriptor(globalThis, 'confirm');
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    beforeEach(() => {
        jest.useFakeTimers();
        mockNoticeMessages.length = 0;
        clearMockSqliteIndex();
        MockSqliteVectorIndex.mockClear();
        mockConfirmUserAction.mockClear();
        mockConfirmUserAction.mockImplementation(() => Promise.resolve(true));
        mockPlatform.isWin = false;
        Object.defineProperty(globalThis, 'confirm', {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: jest.fn(() => 'device-1'),
                setItem: jest.fn(),
            },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        mockPlatform.isWin = false;
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
        if (originalLocalStorage) {
            Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
        } else {
            delete (globalThis as { localStorage?: Storage }).localStorage;
        }
    });

    it('returns an unknown cold snapshot without initializing or touching storage', () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
        const initializeState = jest.spyOn(vssStateStore, 'initialize');
        const readMarker = jest.spyOn(vssStateStore, 'getMarker');
        const vss = new VSS(plugin, 'cache');
        const initialize = jest.spyOn(vss, 'initialize');

        expect(vss.getMemoryStatusSnapshot()).toEqual({
            status: 'unknown',
            dirtyCount: 0,
            verificationPending: 0,
        });
        expect(initialize).not.toHaveBeenCalled();
        expect(initializeState).not.toHaveBeenCalled();
        expect(readMarker).not.toHaveBeenCalled();
        expect(MockSqliteVectorIndex).not.toHaveBeenCalled();
        expect(plugin.getVSSFiles).not.toHaveBeenCalled();
        expect(mockAdapter.list).not.toHaveBeenCalled();
        expect(mockAdapter.read).not.toHaveBeenCalled();
        expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it('returns cloned cached readiness and maintenance counts', () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const internal = vss as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        internal.initialized = true;
        internal.localStateHydrated = true;
        internal.status = 'ready';
        internal.marker = createReadyMarker({ fileCount: 7 });
        internal.dirty.set('notes/dirty.md', { firstSeenAt: 1, lastSeenAt: 1 });
        internal.verifyQueue.set('notes/verify.md', {});

        const snapshot = vss.getMemoryStatusSnapshot();

        expect(snapshot).toEqual({
            status: 'ready',
            indexedDocumentCount: 7,
            dirtyCount: 1,
            verificationPending: 1,
        });
        snapshot.dirtyCount = 99;
        expect(vss.getMemoryStatusSnapshot().dirtyCount).toBe(1);
    });

    it('binds foreground stats to the persisted local marker identity', async () => {
        const { plugin } = createPlugin();
        const index = new FakeVectorIndex();
        index.getStats.mockResolvedValue({
            status: 'ready',
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 1,
            fileCount: 1,
            fallbackMode: false,
            databaseInstanceId: 'database-instance-1',
            chunkMutationEpoch: 4,
            indexMutationEpoch: 6,
            rebuildEpoch: 1,
            lexicalMaintenanceEpoch: 2,
        });
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await expect(vss.getStats({ mode: 'foreground' })).resolves.toMatchObject({
            indexId: 'index-1',
            indexBuiltAt: '2026-05-02T00:00:00.000Z',
            databaseInstanceId: 'database-instance-1',
            chunkMutationEpoch: 4,
            indexMutationEpoch: 6,
            rebuildEpoch: 1,
            lexicalMaintenanceEpoch: 2,
        });
    });

    it.each([
        ['uninitialized', 'unprepared'],
        ['missing-local-index', 'unprepared'],
        ['stale', 'stale'],
        ['disabled', 'error'],
        ['error', 'error'],
    ] as const)('maps hydrated %s state to %s', (internalStatus, expectedStatus) => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const internal = vss as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        internal.initialized = true;
        internal.localStateHydrated = true;
        internal.status = internalStatus;

        expect(vss.getMemoryStatusSnapshot().status).toBe(expectedStatus);
    });

    it('does not load legacy JSON vectors into memory during initialization without a marker', async () => {
        const { plugin, mockAdapter } = createPlugin();
        setMockSqliteIndex(new FakeVectorIndex());
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();

        expect(stats.status).toBe('uninitialized');
        expect(stats.chunkCount).toBe(0);
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
        vss.dispose();
    });

    it('reconstructs the local marker when OPFS has a valid index but IndexedDB marker is missing', async () => {
        const { plugin, vssStateStore } = createPlugin();
        const index = new FakeVectorIndex();
        index.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });
        setMockSqliteIndex(index);
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats({ mode: 'manual' });
        const marker = await vssStateStore.getMarker();

        expect(stats.status).toBe('ready');
        expect(marker).toMatchObject({
            deviceId: 'device-1',
            profileSignature: 'openai||model|1024|COSINE',
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 1,
            fileCount: 1,
        });
        expect(marker?.opfsScope).toEqual(expect.any(String));
        expect(index.reset).not.toHaveBeenCalled();
        expect(index.upsertFile).not.toHaveBeenCalled();
        expect(plugin.getVSSFiles).not.toHaveBeenCalled();
        vss.dispose();
    });

    it('does not reconstruct the local marker from OPFS during foreground startup', async () => {
        const { plugin, vssStateStore } = createPlugin();
        const index = new FakeVectorIndex();
        index.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });
        setMockSqliteIndex(index);
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();

        expect(stats.status).toBe('uninitialized');
        expect(index.initialize).not.toHaveBeenCalled();
        await expect(vssStateStore.getMarker()).resolves.toBeNull();
        vss.dispose();
    });

    it('disposes an in-flight sqlite recovery index when VSS is unloaded', async () => {
        const { plugin } = createPlugin();
        const index = new BlockingInitializeVectorIndex();
        index.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });
        setMockSqliteIndex(index);
        const vss = new VSS(plugin, 'cache');

        const recoveringStats = vss.getStats({ mode: 'manual' });
        await index.waitForInitializeStarted();
        const disposing = vss.dispose();
        index.release();

        await expect(recoveringStats).resolves.toMatchObject({ status: 'uninitialized' });
        await expect(disposing).resolves.toBeUndefined();
        expect(index.dispose).toHaveBeenCalledTimes(1);
        expect(index.getStats).not.toHaveBeenCalled();
        expect((vss as any).index).toBeNull(); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(plugin.log).not.toHaveBeenCalledWith(
            "Could not recover Memory state from local index",
            expect.anything(),
        );
    });

    it('keeps VSS updates running in memory and persists local state after an IndexedDB retry', async () => {
        const stateStore = new FailingOnceStateStore();
        const file = createTFile('note.md', { size: 4, mtime: 1, ctime: 1 }, 'md', 'note.md');
        const { plugin, mockAdapter } = createPlugin({
            createVSSIndexStateStore: jest.fn(() => stateStore),
            getVSSFiles: jest.fn(() => [file]),
        });
        const index = new FakeVectorIndex();
        setMockSqliteIndex(index);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'note.md') return 'hello memory';
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        const summary = await vss.rebuildLocalIndex({ silent: true });
        const readiness = await vss.getMemoryReadiness();

        expect(summary.updated).toBe(1);
        expect(readiness.reason).toBe('ready');
        expect(stateStore.initializeCalls).toBeGreaterThanOrEqual(2);
        expect(mockAdapter.read).toHaveBeenCalledWith('note.md');
        expect(createEmbeddings).toHaveBeenCalled();
        await expect(stateStore.getMarker()).resolves.toMatchObject({
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 1,
            fileCount: 1,
        });
        vss.dispose();
    });

    it('merges persisted dirty journal entries when IndexedDB opens after an unhydrated dirty write', async () => {
        const stateStore = new FailingOnceStateStore();
        await stateStore.setDirtyJournal(new Map([['old.md', { first: 1, last: 2, epoch: 3 }]]));
        const { plugin } = createPlugin({
            createVSSIndexStateStore: jest.fn(() => stateStore),
        });
        setMockSqliteIndex(new FakeVectorIndex());
        const vss = new VSS(plugin, 'cache');
        const file = createTFile('new.md', { size: 4, mtime: 1, ctime: 1 }, 'md', 'new.md');

        await vss.initialize();
        await vss.markDirtyIfEligible(file);

        const dirty = await stateStore.getDirtyJournal();
        expect(dirty.has('old.md')).toBe(true);
        expect(dirty.has('new.md')).toBe(true);
        vss.dispose();
    });

    it('reopens local state after a dirty journal transaction failure', async () => {
        const stateStore = new FailingDirtyWriteOnceStateStore();
        const { plugin } = createPlugin({
            createVSSIndexStateStore: jest.fn(() => stateStore),
        });
        const firstFile = createTFile('first.md', { size: 4, mtime: 1, ctime: 1 }, 'md', 'first.md');
        const secondFile = createTFile('second.md', { size: 4, mtime: 1, ctime: 1 }, 'md', 'second.md');
        const vss = new VSS(plugin, 'cache');

        await vss.markDirtyIfEligible(firstFile);
        await vss.markDirtyIfEligible(secondFile);

        const dirty = await stateStore.getDirtyJournal();
        expect(stateStore.initializeCalls).toBeGreaterThanOrEqual(2);
        expect(dirty.has('first.md')).toBe(true);
        expect(dirty.has('second.md')).toBe(true);
        vss.dispose();
    });

    it('does not let a stale dirty write resurrect state after reset', async () => {
        const stateStore = new DelayedDirtyStateStore();
        const { plugin } = createPlugin({
            createVSSIndexStateStore: jest.fn(() => stateStore),
        });
        const file = createTFile('note.md', { size: 4, mtime: 1, ctime: 1 }, 'md', 'note.md');
        const vss = new VSS(plugin, 'cache');

        const dirtyWrite = vss.markDirtyIfEligible(file);
        await stateStore.waitForWriteScheduled();
        const reset = vss.resetLocalIndex();
        stateStore.release();
        await dirtyWrite;
        await reset;

        await expect(stateStore.getDirtyJournal()).resolves.toEqual(new Map());
        expect(((vss as any).dirty as Map<string, DirtyTimestamps>).size).toBe(0); // eslint-disable-line @typescript-eslint/no-explicit-any
        vss.dispose();
    });

    it('retries reset state clearing without resurrecting old marker or dirty state', async () => {
        const stateStore = new FailingClearStateStore();
        await stateStore.setMarker(createReadyMarker({ chunkCount: 1, fileCount: 1 }));
        await stateStore.setDirtyJournal(new Map([['old.md', { first: 1, last: 2, epoch: 3 }]]));
        const { plugin } = createPlugin({
            createVSSIndexStateStore: jest.fn(() => stateStore),
        });
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
        await vss.getStats();

        await expect(stateStore.getMarker()).resolves.toBeNull();
        await expect(stateStore.getDirtyJournal()).resolves.toEqual(new Map());
        expect((vss as any).marker).toBeNull(); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(((vss as any).dirty as Map<string, DirtyTimestamps>).size).toBe(0); // eslint-disable-line @typescript-eslint/no-explicit-any
        vss.dispose();
    });

    it('does not let an in-flight marker write resurrect state after reset', async () => {
        const { plugin, vssStateStore } = createPlugin();
        const index = new BlockingStatsVectorIndex();
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

        const markerWrite = (vss as any).writeLocalIndexState(); // eslint-disable-line @typescript-eslint/no-explicit-any
        await index.waitForStatsStarted();
        const reset = vss.resetLocalIndex();
        index.release();
        await markerWrite;
        await reset;

        await expect(vssStateStore.getMarker()).resolves.toBeNull();
        expect((vss as any).marker).toBeNull(); // eslint-disable-line @typescript-eslint/no-explicit-any
        vss.dispose();
    });

    it('does not revive a disposed VSS instance from read or rebuild paths', async () => {
        const { plugin } = createPlugin();
        setMockSqliteIndex(new FakeVectorIndex());
        const vss = new VSS(plugin, 'cache');

        vss.dispose();
        const stats = await vss.getStats();
        const results = await vss.searchSimilarity('query');
        const canMaintain = await vss.canAutoMaintain();
        const rebuild = await vss.rebuildLocalIndex({ silent: true });

        expect(stats.status).toBe('uninitialized');
        expect(results).toEqual([]);
        expect(canMaintain).toBe(false);
        expect(rebuild.aborted).toBe(true);
        expect(MockSqliteVectorIndex).not.toHaveBeenCalled();
    });

    it('single-flights concurrent initialization across stats and search paths', async () => {
        const { plugin, vssStateStore } = createPlugin();
        const index = new FakeVectorIndex();
        index.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
            status: 'ready',
            updatedAt: 3,
        });
        setMockSqliteIndex(index);
        await vssStateStore.setMarker(createReadyMarker({ chunkCount: 1, fileCount: 1 }));
        const vss = new VSS(plugin, 'cache');

        await Promise.all([
            vss.getStats(),
            vss.searchSimilarity('query'),
        ]);

        expect(MockSqliteVectorIndex).toHaveBeenCalledTimes(1);
        expect(index.initialize).toHaveBeenCalledTimes(1);
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
            // P0-E: wasm now ships as a Uint8Array via esbuild's binary loader and the
            // inline-assets module wraps it into a (cached) blob URL on first use.
            wasmUrl: expect.stringMatching(/^blob:/),
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

        const calls = MockSqliteVectorIndex.mock.calls.map((call) => call[0] as { databaseName: string; opfsDirectory: string; opfsVfsName: string });
        expect(new Set(calls.map((options) => options.databaseName)).size).toBeGreaterThan(1);
        expect(new Set(calls.map((options) => options.opfsDirectory)).size).toBeGreaterThan(1);
        expect(new Set(calls.map((options) => options.opfsVfsName)).size).toBeGreaterThan(1);
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
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        await vss.rebuildLocalIndex({ silent: true });

        expect(createEmbeddings).toHaveBeenCalledTimes(1);
        expect(index.upsertFile).toHaveBeenCalledTimes(2);
        vss.dispose();
    });

    it('batches rebuild embeddings across files with the qwen v4 request cap', async () => {
        const files = Array.from({ length: 21 }, (_, index) =>
            createTFile(`note-${index}.md`, { size: 30, mtime: index + 1, ctime: 1 }, 'md', `note-${index}.md`)
        );
        const { plugin, mockAdapter } = createPlugin({
            settings: {
                apiToken: 'token',
                vssCacheExcludePath: [],
                aiProvider: 'qwen',
                embeddingModelName: 'text-embedding-v4',
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                chatModelName: '',
            },
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        (vss as any).profile = { // eslint-disable-line @typescript-eslint/no-explicit-any
            provider: 'qwen',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: 'text-embedding-v4',
            dimensions: 1024,
            distanceMetric: 'COSINE',
        };
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.getVSSFiles.mockReturnValue(files);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path.startsWith('note-')) return `memory text for ${path}`;
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn(async (texts: string[]) => texts.map((_, index) => [texts.length, index]));
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });
        const progressEvents: unknown[] = [];

        const summary = await vss.rebuildLocalIndex({
            silent: true,
            onProgress: (event) => progressEvents.push(event),
        });

        expect(summary.updated).toBe(21);
        expect(embedDocuments.mock.calls.map(call => call[0].length)).toEqual([10, 10, 1]);
        expect(createEmbeddings).toHaveBeenCalledWith(1024, expect.objectContaining({
            batchSize: 10,
            maxConcurrency: 1,
            maxRetries: 0,
        }));
        expect(index.upsertFile).toHaveBeenCalledTimes(21);
        expect(progressEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ phase: 'scanning', filesTotal: 21 }),
            expect.objectContaining({ phase: 'embedding', chunksTotal: 21 }),
            expect.objectContaining({ phase: 'writing' }),
            expect.objectContaining({ phase: 'ready', filesDone: 21 }),
        ]));
        vss.dispose();
    });

    it('skips stale rebuild batch items before requesting embeddings', async () => {
        const now = Date.now();
        const staleFile = createTFile('stale-rebuild.md', { size: 19, mtime: now, ctime: now }, 'md', 'stale-rebuild.md');
        const freshFile = createTFile('fresh-rebuild.md', { size: 19, mtime: now, ctime: now }, 'md', 'fresh-rebuild.md');
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        plugin.getVSSFiles.mockReturnValue([staleFile, freshFile]);
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'stale-rebuild.md') return 'stale memory note';
            if (path === 'fresh-rebuild.md') {
                staleFile.stat.mtime = now + 1_000;
                staleFile.stat.size = 30;
                return 'fresh memory note';
            }
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn(async (texts: string[]) => texts.map((_, index) => [index, 1]));
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        const summary = await vss.rebuildLocalIndex({ silent: true });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.updated).toBe(1);
        expect(summary.skipped).toBe(1);
        expect(dirtyMap.has('stale-rebuild.md')).toBe(true);
        expect(embedDocuments).toHaveBeenCalledTimes(1);
        expect(embedDocuments).toHaveBeenCalledWith(['fresh memory note']);
        expect(index.upsertFile).toHaveBeenCalledTimes(1);
        expect(index.upsertFile.mock.calls[0][0].path).toBe('fresh-rebuild.md');
        vss.dispose();
    });

    it('finalizes renamed rebuild items by snapshot path', async () => {
        const now = Date.now();
        const renamedFile = createTFile('rename-source.md', { size: 19, mtime: now, ctime: now }, 'md', 'rename-source.md');
        const freshFile = createTFile('fresh-after-rename.md', { size: 24, mtime: now, ctime: now }, 'md', 'fresh-after-rename.md');
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        plugin.getVSSFiles.mockReturnValue([renamedFile, freshFile]);
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'rename-source.md') return 'rename source memory';
            if (path === 'fresh-after-rename.md') {
                renamedFile.path = 'renamed-target.md';
                renamedFile.name = 'renamed-target.md';
                renamedFile.stat.mtime = now + 1_000;
                renamedFile.stat.size = 30;
                return 'fresh memory note';
            }
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn(async (texts: string[]) => texts.map((_, index) => [index, 1]));
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        const summary = await vss.rebuildLocalIndex({ silent: true });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.updated).toBe(1);
        expect(summary.skipped).toBe(1);
        expect(dirtyMap.has('renamed-target.md')).toBe(true);
        expect(embedDocuments).toHaveBeenCalledTimes(1);
        expect(embedDocuments).toHaveBeenCalledWith(['fresh memory note']);
        expect(index.upsertFile).toHaveBeenCalledTimes(1);
        expect(index.upsertFile.mock.calls[0][0].path).toBe('fresh-after-rename.md');
        vss.dispose();
    });

    it('does not report ready memory while a rebuild is still writing the local index', async () => {
        const file = createTFile('note.md', { size: 18, mtime: 1, ctime: 1 }, 'md', 'note.md');
        const { plugin, mockAdapter } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockResolvedValue('memory text for rebuild');
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        const embedStarted = createDeferred<void>();
        const embedRelease = createDeferred<number[][]>();
        const embedDocuments = jest.fn(async () => {
            embedStarted.resolve();
            return embedRelease.promise;
        });
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        const rebuild = vss.rebuildLocalIndex({ silent: true });
        await embedStarted.promise;

        expect((vss as any).status).toBe('initializing'); // eslint-disable-line @typescript-eslint/no-explicit-any
        await expect(vss.searchSimilarity('query')).resolves.toEqual([]);
        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'unavailable',
            action: 'none',
        });

        embedRelease.resolve([[1, 0]]);
        await rebuild;
        expect((vss as any).status).toBe('ready'); // eslint-disable-line @typescript-eslint/no-explicit-any
        vss.dispose();
    });

    it('revalidates the active index after query embedding work before searching', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        const embedStarted = createDeferred<void>();
        const embedRelease = createDeferred<number[]>();
        const embedQuery = jest.fn(async () => {
            embedStarted.resolve();
            return embedRelease.promise;
        });
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments: jest.fn(), embedQuery });

        const search = vss.searchSimilarity('query');
        await embedStarted.promise;
        await vss.resetLocalIndex();
        embedRelease.resolve([1, 0]);

        await expect(search).resolves.toEqual([]);
        expect(index.search).not.toHaveBeenCalled();
        vss.dispose();
    });

    it('keeps rebuilt chunks grouped by file when batches span files', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        const longFile = createTFile('long.md', { size: 9_000, mtime: 1, ctime: 1 }, 'md', 'long.md');
        const shortFile = createTFile('short.md', { size: 20, mtime: 2, ctime: 1 }, 'md', 'short.md');
        attachReadyIndex(vss, index);
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.getVSSFiles.mockReturnValue([longFile, shortFile]);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'long.md') return 'A'.repeat(9_000);
            if (path === 'short.md') return 'short memory';
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn(async (texts: string[]) => texts.map((_, index) => [index, 1]));
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        await vss.rebuildLocalIndex({ silent: true });

        const longCall = index.upsertFile.mock.calls.find(call => call[0].path === 'long.md');
        const shortCall = index.upsertFile.mock.calls.find(call => call[0].path === 'short.md');
        expect(longCall).toBeDefined();
        expect(shortCall).toBeDefined();
        expect(longCall?.[1].length).toBeGreaterThan(1);
        expect(longCall?.[1].every(chunk => chunk.path === 'long.md')).toBe(true);
        expect(longCall?.[1]).toHaveLength(longCall?.[2].length ?? 0);
        expect(shortCall?.[1]).toHaveLength(1);
        expect(shortCall?.[1][0].path).toBe('short.md');
        vss.dispose();
    });

    it('retries retryable embedding failures and reports retry progress', async () => {
        jest.useRealTimers();
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        const file = createTFile('retry.md', { size: 20, mtime: 1, ctime: 1 }, 'md', 'retry.md');
        attachReadyIndex(vss, index);
        (vss as any).getEmbeddingBatchPolicy = jest.fn(() => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            maxBatchItems: 8,
            minRequestGapMs: 0,
            retryDelaysMs: [1],
            createOptions: { batchSize: 8, maxConcurrency: 1, maxRetries: 0 },
        }));
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.getVSSFiles.mockReturnValue([file]);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'retry.md') return 'retry memory';
            throw createMissingFileError();
        });
        const rateLimitError = Object.assign(new Error('Requests rate limit exceeded'), { status: 429 });
        const embedDocuments = jest.fn<(texts: string[]) => Promise<number[][]>>()
            .mockRejectedValueOnce(rateLimitError)
            .mockResolvedValueOnce([[1, 0]]);
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });
        const progressEvents: unknown[] = [];

        const summary = await vss.rebuildLocalIndex({
            silent: true,
            onProgress: (event) => progressEvents.push(event),
        });

        expect(summary.updated).toBe(1);
        expect(summary.failed).toBe(0);
        expect(embedDocuments).toHaveBeenCalledTimes(2);
        expect(progressEvents).toContainEqual(expect.objectContaining({
            phase: 'retrying',
            retryDelayMs: 1,
        }));
        vss.dispose();
    });

    it('does not retry non-retryable embedding failures', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        const file = createTFile('bad.md', { size: 20, mtime: 1, ctime: 1 }, 'md', 'bad.md');
        attachReadyIndex(vss, index);
        (vss as any).getEmbeddingBatchPolicy = jest.fn(() => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            maxBatchItems: 8,
            minRequestGapMs: 0,
            retryDelaysMs: [1],
            createOptions: { batchSize: 8, maxConcurrency: 1, maxRetries: 0 },
        }));
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.getVSSFiles.mockReturnValue([file]);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'bad.md') return 'bad memory';
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn<(texts: string[]) => Promise<number[][]>>()
            .mockRejectedValue(new Error('invalid embedding input'));
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        const summary = await vss.rebuildLocalIndex({ silent: true });

        expect(summary.updated).toBe(0);
        expect(summary.failed).toBe(1);
        expect(embedDocuments).toHaveBeenCalledTimes(1);
        expect(index.upsertFile).not.toHaveBeenCalled();
        vss.dispose();
    });

    it('stops scheduling later chunks for a file after a rebuild embedding batch fails', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        const file = createTFile('many-chunks.md', { size: 20, mtime: 1, ctime: 1 }, 'md', 'many-chunks.md');
        attachReadyIndex(vss, index);
        (vss as any).getEmbeddingBatchPolicy = jest.fn(() => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            maxBatchItems: 2,
            minRequestGapMs: 0,
            retryDelaysMs: [1],
            createOptions: { batchSize: 2, maxConcurrency: 1, maxRetries: 0 },
        }));
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        (vss as any).prepareFileChunks = jest.fn(async () => Array.from({ length: 5 }, (_, index): VSSChunk => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            path: file.path,
            chunkIndex: index,
            content: `chunk ${index}`,
            contentHash: 'hash',
            created: file.stat.ctime,
            lastModified: file.stat.mtime,
            metadata: {
                path: file.path,
                created: file.stat.ctime,
                lastModified: file.stat.mtime,
                contentHash: 'hash',
                chunkIndex: index,
            },
        })));
        plugin.getVSSFiles.mockReturnValue([file]);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'many-chunks.md') return 'many chunks memory';
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn<(texts: string[]) => Promise<number[][]>>()
            .mockRejectedValue(new Error('invalid embedding input'));
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        const summary = await vss.rebuildLocalIndex({ silent: true });

        expect(summary.updated).toBe(0);
        expect(summary.failed).toBe(1);
        expect(embedDocuments).toHaveBeenCalledTimes(1);
        expect(embedDocuments).toHaveBeenCalledWith(['chunk 0', 'chunk 1']);
        expect(index.upsertFile).not.toHaveBeenCalled();
        vss.dispose();
    });

    it('removes large files from the local index and dirty queue during manual flush', async () => {
        const baseTime = new Date('2025-01-01T00:00:00.000Z');
        jest.setSystemTime(baseTime);

        const { plugin, mockAdapter, mockVault, vssStateStore } = createPlugin();
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
        expect(index.deleteFile).toHaveBeenCalledWith('large.md', expect.objectContaining({ lexicalMaintenanceEnabled: false }));
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
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
        expect(index.deleteFile).toHaveBeenCalledWith('deleted.md', expect.objectContaining({ lexicalMaintenanceEnabled: false }));
        expect(index.records.has('deleted.md')).toBe(false);
        expect(index.upsertFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'keep.md' }), expect.any(Array), expect.any(Array));
    });

    it('removes stale index entries when cleaned markdown content is empty or blank', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockResolvedValue('\n\n');
        const emptyFile = createTFile('empty.md', { size: 2, mtime: Date.now(), ctime: Date.now() }, 'md', 'empty.md');

        const status = await vss.refreshFileCache(emptyFile);

        expect(status).toBe('removed');
        expect(index.deleteFile).toHaveBeenCalledWith('empty.md', expect.objectContaining({ lexicalMaintenanceEnabled: false }));
    });

    it('keeps a note dirty when a removal write races with newer content', async () => {
        const now = Date.now();
        const file = createTFile('empty-race.md', { size: 2, mtime: now, ctime: now }, 'md', 'empty-race.md');
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('empty-race.md', {
            path: 'empty-race.md',
            contentHash: 'old-hash',
            mtime: now - 1_000,
            size: 10,
            status: 'ready',
            updatedAt: now - 1_000,
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'empty-race.md') return '\n\n';
            throw createMissingFileError();
        });
        index.deleteFile.mockImplementationOnce(async (path) => {
            index.records.delete(path);
            file.stat.mtime = now + 1_000;
            file.stat.size = 24;
        });

        const status = await vss.refreshFileCache(file);

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(status).toBe('removed');
        expect(dirtyMap.has('empty-race.md')).toBe(true);
        expect(index.deleteFile).toHaveBeenCalledWith('empty-race.md', expect.objectContaining({ lexicalMaintenanceEnabled: false }));
    });

    it('defers refresh writes when a note changes while its content snapshot is being read', async () => {
        const now = Date.now();
        const file = createTFile('race-refresh.md', { size: 12, mtime: now, ctime: now }, 'md', 'race-refresh.md');
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path !== 'race-refresh.md') throw createMissingFileError();
            file.stat.mtime = now + 1_000;
            file.stat.size = 24;
            return 'old memory';
        });
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        const status = await vss.refreshFileCache(file);

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(status).toBe('skipped');
        expect(dirtyMap.has('race-refresh.md')).toBe(true);
        expect(index.upsertFile).not.toHaveBeenCalled();
        expect(index.updateFileMetadata).not.toHaveBeenCalled();
        expect(createEmbeddings).not.toHaveBeenCalled();
    });

    it('skips embeddings when a note changes before vectors are prepared', async () => {
        const now = Date.now();
        const content = 'stable memory content';
        const file = createTFile('pre-embed-race.md', { size: content.length, mtime: now, ctime: now }, 'md', 'pre-embed-race.md');
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'pre-embed-race.md') return content;
            throw createMissingFileError();
        });
        (vss as any).prepareFileChunks = jest.fn(async (): Promise<VSSChunk[]> => { // eslint-disable-line @typescript-eslint/no-explicit-any
            file.stat.mtime = now + 1_000;
            file.stat.size = content.length + 5;
            return [{
                path: file.path,
                chunkIndex: 0,
                content,
                contentHash: await computeContentHash(content),
                created: file.stat.ctime,
                lastModified: now,
                metadata: {
                    path: file.path,
                    created: file.stat.ctime,
                    lastModified: now,
                    contentHash: await computeContentHash(content),
                    chunkIndex: 0,
                },
            }];
        });
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        const status = await vss.refreshFileCache(file);

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(status).toBe('skipped');
        expect(dirtyMap.has('pre-embed-race.md')).toBe(true);
        expect(createEmbeddings).not.toHaveBeenCalled();
        expect(index.upsertFile).not.toHaveBeenCalled();
    });

    it('defers vector upsert when a note changes after embeddings are prepared', async () => {
        const now = Date.now();
        const content = 'stable memory content';
        const file = createTFile('race-upsert.md', { size: content.length, mtime: now, ctime: now }, 'md', 'race-upsert.md');
        const { plugin, mockAdapter } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'race-upsert.md') return content;
            throw createMissingFileError();
        });
        const embedDocuments = jest.fn(async (texts: string[]) => {
            file.stat.mtime = now + 1_000;
            file.stat.size = content.length + 5;
            return texts.map((_, index) => [index, 1]);
        });
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any
        createEmbeddings.mockResolvedValue({ embedDocuments, embedQuery: jest.fn() });

        const status = await vss.refreshFileCache(file);

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(status).toBe('skipped');
        expect(embedDocuments).toHaveBeenCalled();
        expect(dirtyMap.has('race-upsert.md')).toBe(true);
        expect(index.upsertFile).not.toHaveBeenCalled();
        expect(index.updateFileMetadata).not.toHaveBeenCalled();
    });

    it('does not treat blank exclude paths as matching every file', async () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
        plugin.settings.vssCacheExcludePath = [''];
        const vss = new VSS(plugin, 'cache');
        const file = createTFile('note.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'note.md');

        await vss.markDirtyIfEligible(file);

        expect(((vss as any).dirty as Map<string, DirtyTimestamps>).has('note.md')).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect((await vssStateStore.getDirtyJournal()).has('note.md')).toBe(true);
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
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
        setMockSqliteIndex(new FakeVectorIndex());
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

    it('ignores matching startup-replay observations and clears stale dirty journal entries', async () => {
        const now = Date.now();
        const file = createTFile('same.md', { size: 10, mtime: now, ctime: now }, 'md', 'same.md');
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('same.md', {
            path: 'same.md',
            contentHash: 'same-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set('same.md', { first: now - 60_000, last: now - 60_000 });
        await vssStateStore.setDirtyJournal(new Map(dirtyMap));

        const observation = await vss.observeChangedFile(file, 'vault-modify', 'metadata-drift', {
            verifyMatchingMetadata: false,
        });

        expect(observation).toEqual({ kind: 'ignored', path: 'same.md', reason: 'metadata-match' });
        expect(dirtyMap.has('same.md')).toBe(false);
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
        expect(index.upsertFile).not.toHaveBeenCalled();
    });

    it('queues matching vault modify observations for verification without dirty journal persistence', async () => {
        const now = Date.now();
        const file = createTFile('same.md', { size: 10, mtime: now, ctime: now }, 'md', 'same.md');
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('same.md', {
            path: 'same.md',
            contentHash: 'same-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });

        const observation = await vss.observeChangedFile(file, 'vault-modify', 'metadata-drift', {
            verifyMatchingMetadata: true,
        });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(observation).toEqual({ kind: 'verify-candidate', path: 'same.md', reason: 'vault-modify' });
        expect(dirtyMap.has('same.md')).toBe(false);
        expect(verifyQueue.has('same.md')).toBe(true);
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
        expect(index.upsertFile).not.toHaveBeenCalled();
    });

    it('keeps newer confirmed dirty state when metadata still matches the indexed record', async () => {
        const now = Date.now();
        const file = createTFile('same.md', { size: 10, mtime: now, ctime: now }, 'md', 'same.md');
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('same.md', {
            path: 'same.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now - 5_000,
        });
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set('same.md', { first: now, last: now });
        await vssStateStore.setDirtyJournal(new Map(dirtyMap));

        const observation = await vss.observeChangedFile(file, 'vault-modify');

        expect(observation).toEqual({ kind: 'confirmed-dirty', path: 'same.md', reason: 'already-dirty' });
        expect(dirtyMap.has('same.md')).toBe(true);
        expect((await vssStateStore.getDirtyJournal()).has('same.md')).toBe(true);
    });

    it('marks missing indexed records as confirmed dirty from vault observations', async () => {
        const now = Date.now();
        const file = createTFile('created.md', { size: 11, mtime: now, ctime: now }, 'md', 'created.md');
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        const observation = await vss.observeChangedFile(file, 'vault-create');

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(observation).toEqual({ kind: 'confirmed-dirty', path: 'created.md', reason: 'missing-index-record' });
        expect(dirtyMap.has('created.md')).toBe(true);
        expect((await vssStateStore.getDirtyJournal()).has('created.md')).toBe(true);
    });

    it('queues metadata drift observations for verification without dirty journal persistence', async () => {
        const now = Date.now();
        const file = createTFile('changed.md', { size: 99, mtime: now + 5, ctime: now }, 'md', 'changed.md');
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('changed.md', {
            path: 'changed.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });

        const observation = await vss.observeChangedFile(file, 'vault-modify');
        const plan = await vss.getMemoryReadiness();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(observation).toEqual({ kind: 'verify-candidate', path: 'changed.md', reason: 'vault-modify' });
        expect(dirtyMap.has('changed.md')).toBe(false);
        expect(verifyQueue.has('changed.md')).toBe(true);
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
        expect(plan.reason).toBe('ready');
        expect(plan.verificationPending).toBe(1);
    });

    it('keeps matching startup-scale observations out of dirty journal and embedding', async () => {
        const now = Date.now();
        const files = Array.from({ length: 1000 }, (_, index) =>
            createTFile(`same-${index}.md`, { size: index + 1, mtime: now + index, ctime: now }, 'md', `same-${index}.md`)
        );
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => files),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        for (const file of files) {
            index.records.set(file.path, {
                path: file.path,
                contentHash: `hash-${file.path}`,
                mtime: file.stat.mtime,
                size: file.stat.size,
                status: 'ready',
                updatedAt: now,
            });
        }
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        for (const file of files) {
            await vss.observeChangedFile(file, 'vault-modify', 'metadata-drift', {
                verifyMatchingMetadata: false,
            });
        }

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(dirtyMap.size).toBe(0);
        expect(verifyQueue.size).toBe(0);
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
        expect(createEmbeddings).not.toHaveBeenCalled();
    });

    it('queues metadata drift for verification while marking new notes dirty', async () => {
        const now = Date.now();
        const changed = createTFile('changed.md', { size: 10, mtime: now + 5, ctime: now }, 'md', 'changed.md');
        const created = createTFile('created.md', { size: 11, mtime: now + 6, ctime: now }, 'md', 'created.md');
        const { plugin, mockAdapter, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [changed, created]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('changed.md', {
            path: 'changed.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });
        index.records.set('deleted.md', {
            path: 'deleted.md',
            contentHash: 'deleted-hash',
            mtime: now,
            size: 3,
            status: 'ready',
            updatedAt: now,
        });

        const summary = await vss.reconcileLocalFiles({ verifyHashLimit: 0 });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.markedDirty).toBe(1);
        expect(summary.verificationQueued).toBe(1);
        expect(summary.removed).toBe(1);
        expect(dirtyMap.has('changed.md')).toBe(false);
        expect(dirtyMap.has('created.md')).toBe(true);
        expect(verifyQueue.has('changed.md')).toBe(true);
        expect(index.deleteFile).toHaveBeenCalledWith('deleted.md', expect.objectContaining({ lexicalMaintenanceEnabled: false }));
        const persistedDirty = await vssStateStore.getDirtyJournal();
        expect(persistedDirty.has('created.md')).toBe(true);
        expect(persistedDirty.has('changed.md')).toBe(false);
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
    });

    it('clears stale dirty journal entries during reconcile when indexed metadata already matches', async () => {
        const now = Date.now();
        const file = createTFile('clean.md', { size: 10, mtime: now, ctime: now }, 'md', 'clean.md');
        const { plugin, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('clean.md', {
            path: 'clean.md',
            contentHash: 'clean-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set('clean.md', { first: now - 60_000, last: now - 60_000 });
        await vssStateStore.setDirtyJournal(new Map(dirtyMap));

        const summary = await vss.reconcileLocalFiles({ verifyHashLimit: 0 });

        expect(summary.unchanged).toBe(1);
        expect(dirtyMap.has('clean.md')).toBe(false);
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
    });

    it('does not keep empty or blank missing records dirty during reconcile', async () => {
        const now = Date.now();
        const emptyFile = createTFile('empty.md', { size: 2, mtime: now, ctime: now }, 'md', 'empty.md');
        const { plugin, mockAdapter, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [emptyFile]),
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'empty.md') return '\n\n';
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        await vss.markDirtyIfEligible(emptyFile);
        const summary = await vss.reconcileLocalFiles({ verifyHashLimit: 0 });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const persistedDirty = await vssStateStore.getDirtyJournal();
        expect(summary.markedDirty).toBe(0);
        expect(summary.removed).toBe(1);
        expect(dirtyMap.has('empty.md')).toBe(false);
        expect(persistedDirty.has('empty.md')).toBe(false);
    });

    it('keeps a missing record dirty when blank reconcile reads race with newer content', async () => {
        const now = Date.now();
        const file = createTFile('empty-reconcile-race.md', { size: 2, mtime: now, ctime: now }, 'md', 'empty-reconcile-race.md');
        const { plugin, mockAdapter, vssStateStore } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path !== 'empty-reconcile-race.md') throw createMissingFileError();
            file.stat.mtime = now + 1_000;
            file.stat.size = 26;
            return '\n\n';
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);

        const summary = await vss.reconcileLocalFiles({ verifyHashLimit: 0 });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const persistedDirty = await vssStateStore.getDirtyJournal();
        expect(summary.markedDirty).toBe(1);
        expect(summary.removed).toBe(0);
        expect(dirtyMap.has('empty-reconcile-race.md')).toBe(true);
        expect(persistedDirty.has('empty-reconcile-race.md')).toBe(true);
        expect(index.deleteFile).not.toHaveBeenCalled();
    });

    it('does not mark metadata-only reconcile drift dirty when content is unchanged', async () => {
        jest.useRealTimers();
        const now = Date.now();
        const content = 'same memory content';
        const contentHash = await computeContentHash(content);
        const file = createTFile('same.md', { size: 99, mtime: now + 5, ctime: now }, 'md', 'same.md');
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'same.md') return content;
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('same.md', {
            path: 'same.md',
            contentHash,
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });

        const summary = await vss.reconcileLocalFiles({ verifyHashLimit: 0 });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.markedDirty).toBe(0);
        expect(summary.unchanged).toBe(0);
        expect(summary.verificationQueued).toBe(1);
        expect(dirtyMap.has('same.md')).toBe(false);
        expect(verifyQueue.has('same.md')).toBe(true);
        expect(index.updateFileMetadata).not.toHaveBeenCalled();

        const verifySummary = await vss.verifyPendingChanges();

        expect(verifySummary.metadataSynced).toBe(1);
        expect(verifySummary.dirtyConfirmed).toBe(0);
        expect(dirtyMap.has('same.md')).toBe(false);
        expect(verifyQueue.has('same.md')).toBe(false);
        expect(index.updateFileMetadata).toHaveBeenCalledWith(expect.objectContaining({
            path: 'same.md',
            contentHash,
            mtime: file.stat.mtime,
            size: file.stat.size,
        }));
        expect(index.records.get('same.md')).toMatchObject({
            contentHash,
            mtime: file.stat.mtime,
            size: file.stat.size,
        });
        expect(index.upsertFile).not.toHaveBeenCalled();
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
    });

    it('keeps readiness green when file-open metadata drift is only queued for verification', async () => {
        const now = Date.now();
        const file = createTFile('opened.md', { size: 50, mtime: now + 5, ctime: now }, 'md', 'opened.md');
        const { plugin, mockAdapter } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('opened.md', {
            path: 'opened.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });

        const changed = await vss.handleFileOpen(file);
        const plan = await vss.getMemoryReadiness();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(changed).toBe(true);
        expect(dirtyMap.has('opened.md')).toBe(false);
        expect(verifyQueue.has('opened.md')).toBe(true);
        expect(plan.reason).toBe('ready');
        expect(plan.verificationPending).toBe(1);
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
    });

    it('ignores file-open metadata drift when Memory is not ready', async () => {
        const now = Date.now();
        const file = createTFile('not-ready.md', { size: 50, mtime: now + 5, ctime: now }, 'md', 'not-ready.md');
        const { plugin, mockAdapter } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        (vss as any).status = 'disabled'; // eslint-disable-line @typescript-eslint/no-explicit-any
        index.records.set('not-ready.md', {
            path: 'not-ready.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });

        const changed = await vss.handleFileOpen(file);
        const plan = await vss.getMemoryReadiness();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(changed).toBe(false);
        expect(dirtyMap.has('not-ready.md')).toBe(false);
        expect(verifyQueue.has('not-ready.md')).toBe(false);
        expect(plan.reason).toBe('unavailable');
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
    });

    it('honors verify budgets and leaves remaining candidates queued', async () => {
        jest.useRealTimers();
        const now = Date.now();
        const files = ['one.md', 'two.md', 'three.md'].map((path, index) =>
            createTFile(path, { size: 20 + index, mtime: now + index + 10, ctime: now }, 'md', path)
        );
        const contentByPath = new Map<string, string>(files.map((file) => [file.path, `content for ${file.path}`]));
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => files),
        });
        mockVault.getAbstractFileByPath.mockImplementation((path) => files.find((file) => file.path === path) ?? null);
        mockAdapter.read.mockImplementation(async (path) => {
            const content = contentByPath.get(path);
            if (content !== undefined) return content;
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        for (const file of files) {
            index.records.set(file.path, {
                path: file.path,
                contentHash: await computeContentHash(contentByPath.get(file.path) ?? ''),
                mtime: now,
                size: 1,
                status: 'ready',
                updatedAt: now,
            });
        }

        const reconcileSummary = await vss.reconcileLocalFiles({ verifyHashLimit: 0 });
        const verifySummary = await vss.verifyPendingChanges({
            maxFiles: 1,
            maxBytes: 10_000,
            maxWallClockMs: 1_000,
        });

        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(reconcileSummary.verificationQueued).toBe(3);
        expect(verifySummary.verificationChecked).toBe(1);
        expect(verifySummary.metadataSynced).toBe(1);
        expect(verifySummary.hasMore).toBe(true);
        expect(verifyQueue.size).toBe(2);
    });

    it('counts failed hash reads against the verify file budget', async () => {
        const now = Date.now();
        const files = ['one.md', 'two.md'].map((path, index) =>
            createTFile(path, { size: 20 + index, mtime: now + index + 10, ctime: now }, 'md', path)
        );
        const { plugin, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => files),
        });
        mockVault.getAbstractFileByPath.mockImplementation((path) => files.find((file) => file.path === path) ?? null);
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        for (const file of files) {
            index.records.set(file.path, {
                path: file.path,
                contentHash: `old-${file.path}`,
                mtime: now,
                size: 1,
                status: 'ready',
                updatedAt: now,
            });
            await vss.handleFileOpen(file);
        }
        (vss as any).computeFileHash = jest.fn(async () => { // eslint-disable-line @typescript-eslint/no-explicit-any
            throw new Error('hash failed');
        });

        const verifySummary = await vss.verifyPendingChanges({
            maxFiles: 1,
            maxBytes: 10_000,
            maxWallClockMs: 1_000,
        });

        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(verifySummary.verificationChecked).toBe(1);
        expect(verifySummary.failed).toBe(1);
        expect(verifySummary.hasMore).toBe(true);
        expect(verifyQueue.size).toBe(2);
    });

    it('clears stale verify candidates after a stronger manual refresh succeeds', async () => {
        const now = Date.now();
        const content = 'updated content';
        const file = createTFile('refresh.md', { size: content.length, mtime: now + 5, ctime: now }, 'md', 'refresh.md');
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'refresh.md') return content;
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('refresh.md', {
            path: 'refresh.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 1,
            status: 'ready',
            updatedAt: now,
        });
        await vss.handleFileOpen(file);

        const summary = await vss.flush({ force: true, reason: 'manual-refresh' });

        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.updated).toBe(1);
        expect(verifyQueue.has('refresh.md')).toBe(false);
        expect(index.upsertFile).toHaveBeenCalled();
    });

    it('clears dirty metadata drift without embedding when content hash is unchanged', async () => {
        const baseTime = new Date('2025-01-01T00:00:00.000Z');
        jest.setSystemTime(baseTime);
        const content = 'unchanged memory content';
        const contentHash = await computeContentHash(content);
        const file = createTFile('same.md', { size: 88, mtime: Date.now() + 5, ctime: Date.now() }, 'md', 'same.md');
        const { plugin, mockAdapter, mockVault, vssStateStore } = createPlugin();
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'same.md') return content;
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('same.md', {
            path: 'same.md',
            contentHash,
            mtime: Date.now() - 10_000,
            size: 10,
            status: 'ready',
            updatedAt: Date.now() - 10_000,
        });
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const firstTs = Date.now() - 60_000;
        dirtyMap.set(file.path, { first: firstTs, last: firstTs });
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        const summary = await vss.flush({ limit: 5, reason: 'test-unchanged-metadata' });

        expect(summary.updated).toBe(0);
        expect(summary.unchanged).toBe(0);
        expect(summary.metadataSynced).toBe(1);
        expect(dirtyMap.has('same.md')).toBe(false);
        expect(index.updateFileMetadata).toHaveBeenCalledWith(expect.objectContaining({
            path: 'same.md',
            contentHash,
            mtime: file.stat.mtime,
            size: file.stat.size,
        }));
        expect(index.upsertFile).not.toHaveBeenCalled();
        expect(createEmbeddings).not.toHaveBeenCalled();
        expect(await vssStateStore.getDirtyJournal()).toEqual(new Map());
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
    });

    it('does not clear a newer dirty event while verifying an older metadata candidate', async () => {
        jest.useRealTimers();
        const now = Date.now();
        const file = createTFile('race.md', { size: 88, mtime: now + 5, ctime: now }, 'md', 'race.md');
        const content = 'same content';
        const contentHash = await computeContentHash(content);
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('race.md', {
            path: 'race.md',
            contentHash,
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });
        await vss.handleFileOpen(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path !== 'race.md') throw createMissingFileError();
            (vss as any).markDirtyPath('race.md', now + 100); // eslint-disable-line @typescript-eslint/no-explicit-any
            return content;
        });

        const summary = await vss.verifyPendingChanges();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.metadataSynced).toBe(0);
        expect(dirtyMap.has('race.md')).toBe(true);
        expect(index.updateFileMetadata).not.toHaveBeenCalled();
    });

    it('does not bind an old verified hash to newer file metadata', async () => {
        jest.useRealTimers();
        const now = Date.now();
        const content = 'same content';
        const contentHash = await computeContentHash(content);
        const file = createTFile('metadata-race.md', { size: 88, mtime: now + 5, ctime: now }, 'md', 'metadata-race.md');
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path !== 'metadata-race.md') throw createMissingFileError();
            file.stat.mtime = now + 10_000;
            file.stat.size = 120;
            return content;
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('metadata-race.md', {
            path: 'metadata-race.md',
            contentHash,
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });
        await vss.handleFileOpen(file);

        const summary = await vss.verifyPendingChanges();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.metadataSynced).toBe(0);
        expect(summary.dirtyConfirmed).toBe(1);
        expect(dirtyMap.has('metadata-race.md')).toBe(true);
        expect(index.updateFileMetadata).not.toHaveBeenCalled();
        expect(index.records.get('metadata-race.md')).toMatchObject({
            contentHash,
            mtime: now,
            size: 10,
        });
    });

    it('keeps a verify candidate dirty when blank verification reads race with newer content', async () => {
        jest.useRealTimers();
        const now = Date.now();
        const file = createTFile('verify-empty-race.md', { size: 2, mtime: now + 5, ctime: now }, 'md', 'verify-empty-race.md');
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path !== 'verify-empty-race.md') throw createMissingFileError();
            file.stat.mtime = now + 10_000;
            file.stat.size = 30;
            return '\n\n';
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('verify-empty-race.md', {
            path: 'verify-empty-race.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 10,
            status: 'ready',
            updatedAt: now,
        });
        await vss.handleFileOpen(file);

        const summary = await vss.verifyPendingChanges();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.removed).toBe(0);
        expect(summary.dirtyConfirmed).toBe(1);
        expect(dirtyMap.has('verify-empty-race.md')).toBe(true);
        expect(index.deleteFile).not.toHaveBeenCalled();
    });

    it('preserves a newer verify record created during metadata sync writes', async () => {
        jest.useRealTimers();
        const now = Date.now();
        const content = 'same content';
        const contentHash = await computeContentHash(content);
        const file = createTFile('verify-write-race.md', { size: content.length, mtime: now + 5, ctime: now }, 'md', 'verify-write-race.md');
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path !== 'verify-write-race.md') throw createMissingFileError();
            return content;
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('verify-write-race.md', {
            path: 'verify-write-race.md',
            contentHash,
            mtime: now,
            size: 1,
            status: 'ready',
            updatedAt: now,
        });
        await vss.handleFileOpen(file);
        index.updateFileMetadata.mockImplementationOnce(async (fileState) => {
            index.records.set(fileState.path, {
                path: fileState.path,
                contentHash: fileState.contentHash,
                mtime: fileState.mtime,
                size: fileState.size,
                status: 'ready',
                updatedAt: now,
            });
            file.stat.mtime = now + 10_000;
            file.stat.size = content.length + 5;
            await vss.observeChangedFile(file, 'vault-modify', 'metadata-drift');
        });

        const summary = await vss.verifyPendingChanges();

        const verifyQueue = (vss as any).verifyQueue as Map<string, { observedMtime: number; observedSize: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.metadataSynced).toBe(0);
        expect(summary.hasMore).toBe(true);
        expect(verifyQueue.get('verify-write-race.md')).toMatchObject({
            observedMtime: now + 10_000,
            observedSize: content.length + 5,
        });
        expect(index.updateFileMetadata).toHaveBeenCalledTimes(1);
    });

    it('uses rolling hash verification to catch synced content changes without metadata changes', async () => {
        const now = Date.now();
        const file = createTFile('same-meta.md', { size: 12, mtime: now, ctime: now }, 'md', 'same-meta.md');
        const { plugin, mockAdapter, mockVault } = createPlugin({
            getVSSFiles: jest.fn(() => [file]),
        });
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        index.records.set('same-meta.md', {
            path: 'same-meta.md',
            contentHash: 'old-hash',
            mtime: now,
            size: 12,
            status: 'ready',
            updatedAt: now,
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'same-meta.md') return 'new synced content';
            throw createMissingFileError();
        });

        const reconcileSummary = await vss.reconcileLocalFiles({ reason: 'periodic', verifyHashLimit: 1 });

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const verifyQueue = (vss as any).verifyQueue as Map<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(reconcileSummary.verified).toBe(1);
        expect(reconcileSummary.verificationQueued).toBe(1);
        expect(reconcileSummary.markedDirty).toBe(0);
        expect(dirtyMap.has('same-meta.md')).toBe(false);
        expect(verifyQueue.has('same-meta.md')).toBe(true);

        const verifySummary = await vss.verifyPendingChanges();

        expect(verifySummary.dirtyConfirmed).toBe(1);
        expect(dirtyMap.has('same-meta.md')).toBe(true);
        expect(verifyQueue.has('same-meta.md')).toBe(false);
    });

    it('settles hasMore after continuing a large metadata reconcile round', async () => {
        const now = Date.now();
        const files = Array.from({ length: 1001 }, (_, index) =>
            createTFile(`large-${index}.md`, { size: index + 1, mtime: now + index, ctime: now }, 'md', `large-${index}.md`)
        );
        const { plugin } = createPlugin({
            getVSSFiles: jest.fn(() => files),
        });
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        for (const file of files) {
            index.records.set(file.path, {
                path: file.path,
                contentHash: `hash-${file.path}`,
                mtime: file.stat.mtime,
                size: file.stat.size,
                status: 'ready',
                updatedAt: now,
            });
        }

        const first = await vss.reconcileLocalFiles({ batchSize: 10_000, maxMetadataItems: 2000, verifyHashLimit: 0 });
        const second = await vss.reconcileLocalFiles({ batchSize: 10_000, maxMetadataItems: 2000, verifyHashLimit: 0 });

        expect(first.hasMore).toBe(true);
        expect(first.scanned).toBe(2000);
        expect(second.hasMore).toBe(false);
        expect(second.scanned).toBe(2);
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

    it('keeps the lexical slice default-off and requests explicit lexical-only approval when enabled', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        attachReadyIndex(vss, index);

        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'ready',
            action: 'none',
        });

        index.lexicalStatus = {
            state: 'unavailable',
            reason: 'feature_disabled',
            chunkCount: 2,
            lexicalRowCount: 0,
        };
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'lexical-profile-stale',
            action: 'rebuild-lexical',
            requiresApproval: true,
            canAnswerNow: true,
        });
    });

    it('keeps lexical work disabled when the Windows policy masks a persisted flag', async () => {
        mockPlatform.isWin = true;
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        index.lexicalStatus = {
            state: 'unavailable',
            reason: 'feature_disabled',
            chunkCount: 2,
            lexicalRowCount: 0,
        };
        attachReadyIndex(vss, index);

        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'ready',
            action: 'none',
        });
        expect(plugin.settings.retrievalOptimizationFlags).toEqual({ lexicalProfile: true });
    });

    it('selects exact baseline/candidate payloads when the lexical calibration flag changes', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);

        await vss.searchHybrid('差旅报销;电子发票');
        const flagOffArgs = index.searchHybridDetailed.mock.calls[0] as unknown as unknown[];
        expect(flagOffArgs[1]).toBeNull();
        expect(flagOffArgs[2]).toBe(8);
        expect(flagOffArgs[3]).toBe(12);
        expect(flagOffArgs[9]).toEqual(RETRIEVAL_CALIBRATION_PROFILE.baseline.standard);

        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        await vss.searchHybrid('差旅报销;电子发票');
        const flagOnArgs = index.searchHybridDetailed.mock.calls[1] as unknown as unknown[];
        expect(flagOnArgs[1]).toContain(' OR ');
        expect(flagOnArgs[2]).toBe(8);
        expect(flagOnArgs[3]).toBe(18);
        expect(flagOnArgs[9]).toEqual(RETRIEVAL_CALIBRATION_PROFILE.candidate.standard);
    });

    it('starts the local lexical budget after delayed provider rewrite and embedding settle', async () => {
        const providerStartedAt = new Date('2026-08-11T01:00:00.000Z').getTime();
        jest.setSystemTime(providerStartedAt);
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        index.lexicalStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 1,
            lexicalRowCount: 1,
        };
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        index.searchHybridDetailed.mockImplementation(async () => {
            const args = index.searchHybridDetailed.mock.calls.at(-1) as unknown as unknown[];
            const budget = args[7] as { startedAtMs: number; deadlineAtMs: number };
            const attempted = Date.now() < budget.deadlineAtMs;
            return {
                results: attempted ? [{
                    score: 1,
                    doc: new Document({
                        pageContent: 'exact lexical result',
                        metadata: { path: 'exact-lexical.md' },
                    }),
                }] : [],
                sourceEpoch: '7',
                lexical: {
                    attempted,
                    state: 'ready' as const,
                    reason: attempted ? undefined : 'not_started_budget',
                },
            };
        });
        const rewrite = createDeferred<string | null>();
        const embeddingStarted = createDeferred<void>();
        const embeddingRelease = createDeferred<void>();
        const pendingSearch = vss.searchHybrid('召回', {
            ftsQueryOverridePromise: rewrite.promise,
            executeEmbeddingInvoke: async (invoke) => {
                const embedding = await invoke();
                embeddingStarted.resolve();
                await embeddingRelease.promise;
                return embedding;
            },
        });
        await embeddingStarted.promise;
        const localPhaseStartedAt = providerStartedAt
            + RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.searchBudgetMs
            + 100;
        jest.setSystemTime(localPhaseStartedAt);
        rewrite.resolve('召回');
        embeddingRelease.resolve();

        await expect(pendingSearch).resolves.toEqual([
            expect.objectContaining({
                doc: expect.objectContaining({
                    metadata: expect.objectContaining({ path: 'exact-lexical.md' }),
                }),
            }),
        ]);
        const searchArgs = index.searchHybridDetailed.mock.calls[0] as unknown as unknown[];
        expect(searchArgs[1]).not.toBeNull();
        expect(searchArgs[7]).toEqual({
            startedAtMs: localPhaseStartedAt,
            deadlineAtMs: localPhaseStartedAt
                + RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.searchBudgetMs,
        });
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: true,
            lexicalSearchState: 'ready',
        });
    });

    it('removes an aborted recovery operation from the VSS foreground queue before dispatch', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const activeStarted = createDeferred<void>();
        const activeRelease = createDeferred<void>();
        const active = (vss as any).runExclusive(async () => { // eslint-disable-line @typescript-eslint/no-explicit-any
            activeStarted.resolve(undefined);
            await activeRelease.promise;
        });
        await activeStarted.promise;
        const controller = new AbortController();
        const operation = jest.fn(async () => 'should-not-run');
        const queued = (vss as any).runExclusive( // eslint-disable-line @typescript-eslint/no-explicit-any
            operation,
            'foreground',
            false,
            controller.signal,
        ) as Promise<string>;
        expect((vss as any).foregroundOperations).toHaveLength(1); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });

        controller.abort();
        await rejected;
        expect((vss as any).foregroundOperations).toHaveLength(0); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(operation).not.toHaveBeenCalled();

        activeRelease.resolve(undefined);
        await active;
        await Promise.resolve();
        expect(operation).not.toHaveBeenCalled();
    });

    it('fails an active hybrid caller closed and keeps its late result out of the next run', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        index.lexicalStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 2,
            lexicalRowCount: 2,
        };
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const firstStarted = createDeferred<void>();
        const lateResult = createDeferred<Awaited<ReturnType<
            FakeLexicalVectorIndex['searchHybridDetailed']
        >>>();
        index.searchHybridDetailed
            .mockImplementationOnce(async () => {
                firstStarted.resolve(undefined);
                return lateResult.promise;
            })
            .mockResolvedValueOnce({
                results: [{
                    score: 0.5,
                    doc: new Document({
                        pageContent: 'fresh result',
                        metadata: { path: 'fresh.md' },
                    }),
                }],
                sourceEpoch: 'fresh-epoch',
                lexical: { attempted: true, state: 'ready', reason: undefined },
            });
        const controller = new AbortController();
        const firstEmbedding: { value?: number[]; profileSignature?: string; sourceEpoch?: string } = {};
        const first = vss.searchHybrid('first recovery', {
            signal: controller.signal,
            queryEmbeddingOut: firstEmbedding,
        });
        await firstStarted.promise;
        const firstIndexArgs = index.searchHybridDetailed.mock.calls[0] as unknown as unknown[];
        expect(firstIndexArgs[10]).toEqual({ signal: controller.signal });
        const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });

        controller.abort();
        await firstRejected;
        expect(firstEmbedding).toEqual({
            value: undefined,
            profileSignature: undefined,
            sourceEpoch: undefined,
        });
        expect(vss.getMemoryStatusSnapshot().lexicalSearchMatchedRows).toBeUndefined();

        const second = vss.searchHybrid('second recovery');
        await Promise.resolve();
        expect(index.searchHybridDetailed).toHaveBeenCalledTimes(1);

        lateResult.resolve({
            results: [{
                score: 1,
                doc: new Document({
                    pageContent: 'stale late result',
                    metadata: { path: 'stale.md' },
                }),
            }],
            sourceEpoch: 'stale-epoch',
            lexical: { attempted: false, state: 'ready', reason: 'stale-late-result' },
        });

        await expect(second).resolves.toEqual([
            expect.objectContaining({
                doc: expect.objectContaining({
                    metadata: expect.objectContaining({ path: 'fresh.md' }),
                }),
            }),
        ]);
        expect(index.searchHybridDetailed).toHaveBeenCalledTimes(2);
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: true,
            lexicalSearchReason: undefined,
        });
    });

    it('shares one local lexical budget across a same-search evidence rerun', async () => {
        const localPhaseStartedAt = new Date('2026-08-11T02:00:00.000Z').getTime();
        jest.setSystemTime(localPhaseStartedAt);
        const currentFile = createTFile('current.md', { mtime: 10, size: 20 });
        const { plugin, mockVault } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        mockVault.getAbstractFileByPath.mockImplementation((path) => (
            path === currentFile.path ? currentFile : null
        ));
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex() as FakeLexicalVectorIndex & {
            getPathEvidenceGenerations: jest.Mock<
                (paths: string[]) => Promise<IndexedPathEvidenceGenerationResult>
            >;
        };
        index.lexicalStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 1,
            lexicalRowCount: 1,
        };
        let evidenceLookupCount = 0;
        index.getPathEvidenceGenerations = jest.fn(async (paths: string[]) => {
            evidenceLookupCount += 1;
            return {
                sourceEpoch: '7',
                paths: paths.map((path) => ({
                    path,
                    generation: evidenceLookupCount === 1 ? 'generation-1' : 'generation-2',
                    contentHash: 'hash-current',
                    mtime: 10,
                    size: 20,
                })),
            };
        });
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const observedBudgets: Array<{ startedAtMs: number; deadlineAtMs: number }> = [];
        index.searchHybridDetailed.mockImplementation(async () => {
            const args = index.searchHybridDetailed.mock.calls.at(-1) as unknown as unknown[];
            const budget = args[7] as { startedAtMs: number; deadlineAtMs: number };
            observedBudgets.push(budget);
            const attempted = Date.now() < budget.deadlineAtMs;
            if (observedBudgets.length === 1) {
                jest.setSystemTime(budget.deadlineAtMs + 1);
            }
            return {
                results: [] as VectorSearchResult[],
                sourceEpoch: '7',
                lexical: {
                    attempted,
                    state: 'ready' as const,
                    reason: attempted ? undefined : 'not_started_budget',
                },
            };
        });

        await expect(vss.searchHybrid('召回', {
            excludeUnchangedPathGenerations: [{
                path: currentFile.path,
                generation: 'generation-1',
            }],
        })).resolves.toEqual([]);

        expect(index.searchHybridDetailed).toHaveBeenCalledTimes(2);
        expect(index.getPathEvidenceGenerations).toHaveBeenCalledTimes(2);
        expect(observedBudgets).toHaveLength(2);
        expect(observedBudgets[1]).toBe(observedBudgets[0]);
        expect(observedBudgets[0]).toEqual({
            startedAtMs: localPhaseStartedAt,
            deadlineAtMs: localPhaseStartedAt
                + RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.searchBudgetMs,
        });
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: false,
            lexicalSearchReason: 'not_started_budget',
        });
    });

    it('discards a delayed lexical-fused result when the live flag is disabled mid-search', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const firstSearchStarted = createDeferred<void>();
        const delayedLexicalResult = createDeferred<Awaited<ReturnType<
            FakeLexicalVectorIndex['searchHybridDetailed']
        >>>();
        index.searchHybridDetailed
            .mockImplementationOnce(async () => {
                firstSearchStarted.resolve();
                return delayedLexicalResult.promise;
            })
            .mockResolvedValueOnce({
                results: [{
                    score: 0.8,
                    doc: new Document({
                        pageContent: 'vector-only result',
                        metadata: { path: 'vector-only.md' },
                    }),
                }],
                sourceEpoch: '7',
                lexical: {
                    attempted: false,
                    state: 'unavailable',
                    reason: 'feature_disabled',
                },
            });

        const pendingSearch = vss.searchHybrid('差旅报销;电子发票');
        await firstSearchStarted.promise;
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: false };
        delayedLexicalResult.resolve({
            results: [{
                score: 1,
                doc: new Document({
                    pageContent: 'stale lexical-fused result',
                    metadata: { path: 'stale-lexical.md' },
                }),
            }],
            sourceEpoch: '7',
            lexical: {
                attempted: true,
                state: 'ready',
                reason: undefined,
            },
        });

        await expect(pendingSearch).resolves.toEqual([
            expect.objectContaining({
                doc: expect.objectContaining({
                    metadata: expect.objectContaining({ path: 'vector-only.md' }),
                }),
            }),
        ]);
        expect(index.searchHybridDetailed).toHaveBeenCalledTimes(2);
        const lexicalArgs = index.searchHybridDetailed.mock.calls[0] as unknown as unknown[];
        const vectorOnlyArgs = index.searchHybridDetailed.mock.calls[1] as unknown as unknown[];
        expect(lexicalArgs[1]).not.toBeNull();
        expect(lexicalArgs[9]).toEqual(RETRIEVAL_CALIBRATION_PROFILE.candidate.standard);
        expect(vectorOnlyArgs[1]).toBeNull();
        expect(vectorOnlyArgs[2]).toBe(8);
        expect(vectorOnlyArgs[3]).toBe(12);
        expect(vectorOnlyArgs[5]).toBe('feature_disabled');
        expect(vectorOnlyArgs[9]).toEqual(RETRIEVAL_CALIBRATION_PROFILE.baseline.standard);
    });

    it('discards a lexical-fused result when a microtask disables the live flag during the second status refresh', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const secondStatusStarted = createDeferred<void>();
        const secondStatusRelease = createDeferred<LexicalIndexStatus>();
        const readyStatus: LexicalIndexStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 1,
            lexicalRowCount: 1,
        };
        index.getLexicalStatus
            .mockResolvedValueOnce({
                state: 'awaiting_confirmation',
                reason: 'profile_missing',
                chunkCount: 1,
                lexicalRowCount: 0,
            })
            .mockImplementationOnce(async () => {
                secondStatusStarted.resolve();
                return secondStatusRelease.promise;
            });
        index.searchHybridDetailed
            .mockResolvedValueOnce({
                results: [{
                    score: 1,
                    doc: new Document({
                        pageContent: 'stale lexical-fused result',
                        metadata: { path: 'stale-lexical.md' },
                    }),
                }],
                sourceEpoch: '7',
                lexical: {
                    attempted: true,
                    state: 'ready',
                    reason: undefined,
                },
            })
            .mockResolvedValueOnce({
                results: [{
                    score: 0.8,
                    doc: new Document({
                        pageContent: 'vector-only result',
                        metadata: { path: 'vector-only.md' },
                    }),
                }],
                sourceEpoch: '8',
                lexical: {
                    attempted: false,
                    state: 'unavailable',
                    reason: 'feature_disabled',
                },
            });
        const controller = new AbortController();

        const pendingSearch = vss.searchHybrid('差旅报销;电子发票', { signal: controller.signal });
        await secondStatusStarted.promise;
        const flagDisabled = Promise.resolve().then(() => {
            plugin.settings.retrievalOptimizationFlags = { lexicalProfile: false };
        });
        secondStatusRelease.resolve(readyStatus);
        await flagDisabled;

        await expect(pendingSearch).resolves.toEqual([
            expect.objectContaining({
                doc: expect.objectContaining({
                    metadata: expect.objectContaining({ path: 'vector-only.md' }),
                }),
            }),
        ]);
        expect(index.searchHybridDetailed).toHaveBeenCalledTimes(2);
        const lexicalArgs = index.searchHybridDetailed.mock.calls[0] as unknown as unknown[];
        const vectorOnlyArgs = index.searchHybridDetailed.mock.calls[1] as unknown as unknown[];
        expect(vectorOnlyArgs[0]).toBe(lexicalArgs[0]);
        expect(vectorOnlyArgs[1]).toBeNull();
        expect(vectorOnlyArgs[2]).toBe(8);
        expect(vectorOnlyArgs[3]).toBe(12);
        expect(vectorOnlyArgs[5]).toBe('feature_disabled');
        expect(vectorOnlyArgs[7]).toBe(lexicalArgs[7]);
        expect(vectorOnlyArgs[9]).toEqual(RETRIEVAL_CALIBRATION_PROFILE.baseline.standard);
        expect(vectorOnlyArgs[10]).toEqual({ signal: controller.signal });
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: false,
            lexicalSearchState: 'unavailable',
            lexicalSearchReason: 'feature_disabled',
        });
    });

    it('clears invocation output and preserves cached status when disposed during the second lexical status refresh', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const cachedStatus: LexicalIndexStatus = {
            state: 'awaiting_confirmation',
            reason: 'profile_missing',
            chunkCount: 1,
            lexicalRowCount: 0,
        };
        (vss as any).lexicalStatus = cachedStatus; // eslint-disable-line @typescript-eslint/no-explicit-any
        const secondStatusStarted = createDeferred<void>();
        const secondStatusRelease = createDeferred<LexicalIndexStatus>();
        index.getLexicalStatus
            .mockResolvedValueOnce(cachedStatus)
            .mockImplementationOnce(async () => {
                secondStatusStarted.resolve();
                return secondStatusRelease.promise;
            });
        index.searchHybridDetailed.mockResolvedValueOnce({
            results: [{
                score: 1,
                doc: new Document({
                    pageContent: 'stale lexical-fused result',
                    metadata: { path: 'stale-lexical.md' },
                }),
            }],
            sourceEpoch: 'stale-epoch',
            lexical: {
                attempted: true,
                state: 'ready',
                reason: undefined,
            },
        });
        const queryEmbeddingOut: {
            value?: number[];
            profileSignature?: string;
            sourceEpoch?: string;
        } = {};

        const pendingSearch = vss.searchHybrid('差旅报销;电子发票', { queryEmbeddingOut });
        await secondStatusStarted.promise;
        expect(queryEmbeddingOut.value).toBeDefined();
        const disposing = vss.dispose();
        secondStatusRelease.resolve({
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 1,
            lexicalRowCount: 1,
        });

        await expect(pendingSearch).resolves.toEqual([]);
        await disposing;
        expect(queryEmbeddingOut).toEqual({
            value: undefined,
            profileSignature: undefined,
            sourceEpoch: undefined,
        });
        expect((vss as any).lexicalStatus).toBe(cachedStatus); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: undefined,
            lexicalSearchState: undefined,
            lexicalSearchReason: undefined,
        });
        expect(index.searchHybridDetailed).toHaveBeenCalledTimes(1);
    });

    it('rethrows sqlite index disposal from lexical status refresh and clears invocation output', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const cachedStatus: LexicalIndexStatus = {
            state: 'awaiting_confirmation',
            reason: 'profile_missing',
            chunkCount: 1,
            lexicalRowCount: 0,
        };
        (vss as any).lexicalStatus = cachedStatus; // eslint-disable-line @typescript-eslint/no-explicit-any
        index.getLexicalStatus.mockRejectedValueOnce(Object.assign(
            new Error('disposed during status refresh'),
            { code: 'sqlite-vector-index-disposed' },
        ));
        index.searchHybridDetailed.mockResolvedValueOnce({
            results: [{
                score: 1,
                doc: new Document({
                    pageContent: 'stale lexical-fused result',
                    metadata: { path: 'stale-lexical.md' },
                }),
            }],
            sourceEpoch: 'stale-epoch',
            lexical: {
                attempted: true,
                state: 'ready',
                reason: undefined,
            },
        });
        const queryEmbeddingOut: {
            value?: number[];
            profileSignature?: string;
            sourceEpoch?: string;
        } = {};

        await expect(vss.searchHybrid('差旅报销;电子发票', { queryEmbeddingOut }))
            .rejects.toMatchObject({ code: 'sqlite-vector-index-disposed' });

        expect(queryEmbeddingOut).toEqual({
            value: undefined,
            profileSignature: undefined,
            sourceEpoch: undefined,
        });
        expect((vss as any).lexicalStatus).toBe(cachedStatus); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: undefined,
            lexicalSearchState: undefined,
            lexicalSearchReason: undefined,
        });
    });

    it('rejects an old hybrid result when another config refresh replaces its index during status refresh', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const oldIndex = new FakeLexicalVectorIndex();
        const replacementIndex = new FakeLexicalVectorIndex();
        Object.setPrototypeOf(oldIndex, MockSqliteVectorIndex.prototype);
        Object.setPrototypeOf(replacementIndex, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, oldIndex);
        const cachedStatus: LexicalIndexStatus = {
            state: 'awaiting_confirmation',
            reason: 'profile_missing',
            chunkCount: 1,
            lexicalRowCount: 0,
        };
        (vss as any).lexicalStatus = cachedStatus; // eslint-disable-line @typescript-eslint/no-explicit-any
        const statusStarted = createDeferred<void>();
        const lateStatus = createDeferred<LexicalIndexStatus>();
        oldIndex.getLexicalStatus.mockImplementationOnce(async () => {
            statusStarted.resolve();
            return lateStatus.promise;
        });
        oldIndex.searchHybridDetailed.mockResolvedValueOnce({
            results: [{
                score: 1,
                doc: new Document({
                    pageContent: 'old-profile result',
                    metadata: { path: 'old-profile.md' },
                }),
            }],
            sourceEpoch: 'old-source-epoch',
            lexical: {
                attempted: true,
                state: 'ready',
                reason: undefined,
            },
        });
        setMockSqliteIndex(replacementIndex);
        const queryEmbeddingOut: {
            value?: number[];
            profileSignature?: string;
            sourceEpoch?: string;
        } = {};

        const pendingSearch = vss.searchHybrid('差旅报销;电子发票', { queryEmbeddingOut });
        await statusStarted.promise;
        expect(queryEmbeddingOut.value).toBeDefined();
        plugin.settings.embeddingModelName = 'replacement-model';
        await (vss as any).ensureIndex({ // eslint-disable-line @typescript-eslint/no-explicit-any
            allowFallback: false,
            mode: 'foreground',
        });
        expect(oldIndex.dispose).toHaveBeenCalledTimes(1);
        expect((vss as any).index).toBe(replacementIndex); // eslint-disable-line @typescript-eslint/no-explicit-any
        lateStatus.resolve({
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
            },
            chunkCount: 1,
            lexicalRowCount: 1,
        });

        await expect(pendingSearch).rejects.toMatchObject({ code: 'vss-search-invocation-changed' });
        expect(queryEmbeddingOut).toEqual({
            value: undefined,
            profileSignature: undefined,
            sourceEpoch: undefined,
        });
        expect((vss as any).lexicalStatus).toBe(cachedStatus); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalSearchAttempted: undefined,
            lexicalSearchState: undefined,
            lexicalSearchReason: undefined,
        });
        expect(replacementIndex.searchHybridDetailed).not.toHaveBeenCalled();
    });

    it('marks a ready lexical generation stale when the eligibility policy changes', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        plugin.settings.dataBoundary = {
            excludedFolders: [],
            excludedTags: [],
            generatedNotePolicy: 'exclude-generated',
        };
        plugin.settings.vssCacheExcludePath = ['private/'];
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        const originalFingerprint = (vss as any).getLexicalBoundaryFingerprint(); // eslint-disable-line @typescript-eslint/no-explicit-any
        index.lexicalStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 0,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
                scopeFingerprint: originalFingerprint,
                eligibleRowCount: 0,
            },
            chunkCount: 0,
            lexicalRowCount: 0,
        };
        attachReadyIndex(vss, index);

        // These values are not equivalent: the first allows `private.md`, the
        // second excludes it. The lexical policy fingerprint must change too.
        plugin.settings.vssCacheExcludePath = ['private'];
        await expect(vss.getMemoryReadiness()).resolves.toMatchObject({
            reason: 'lexical-profile-stale',
            action: 'rebuild-lexical',
            requiresApproval: true,
        });
    });

    it('keeps scope_changed effective status observable after hybrid fallback', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        plugin.settings.dataBoundary = {
            excludedFolders: [],
            excludedTags: [],
            generatedNotePolicy: 'exclude-generated',
        };
        plugin.settings.vssCacheExcludePath = ['private/'];
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        const originalFingerprint = (vss as any).getLexicalBoundaryFingerprint(); // eslint-disable-line @typescript-eslint/no-explicit-any
        index.lexicalStatus = {
            state: 'ready',
            marker: {
                profileId: 'char-phrase-v1',
                generation: 1,
                sourceChunkEpoch: '7',
                runtimeCanaryFingerprint: 'canary',
                scopeFingerprint: originalFingerprint,
                eligibleRowCount: 0,
            },
            chunkCount: 0,
            lexicalRowCount: 0,
        };
        index.searchHybridDetailed.mockResolvedValue({
            results: [],
            sourceEpoch: '7',
            lexical: {
                attempted: false,
                state: 'stale',
                reason: 'scope_changed',
            },
        });
        // VSS intentionally exposes SQLite-only hybrid APIs behind this
        // concrete runtime check; preserve the fake's own methods while making
        // that backend identity explicit for this regression.
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);

        plugin.settings.vssCacheExcludePath = ['private'];
        await expect(vss.searchHybrid('query')).resolves.toEqual([]);
        expect(vss.getMemoryStatusSnapshot()).toMatchObject({
            lexicalProfileState: 'stale',
            lexicalFallbackReason: 'scope_changed',
            lexicalSearchState: 'stale',
            lexicalSearchReason: 'scope_changed',
        });
        await expect(vss.getStats()).resolves.toMatchObject({
            lexicalProfileState: 'stale',
            lexicalFallbackReason: 'scope_changed',
        });
    });

    it('forwards invocation-local Graph lifecycle diagnostics to the SQLite index', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const rankGraphCandidates = jest.fn<(
            queryEmbedding: number[],
            paths: string[],
            control: RankedPathRequestControl,
            options?: RankGraphCandidatesOptions,
        ) => Promise<RankedPathRequestResult>>(async (_embedding, _paths, control, options) => {
            options?.onDiagnostic?.({ state: 'cancel_requested', accepted: 0 });
            return {
                requestId: control.requestId,
                runEpoch: control.runEpoch,
                sourceEpoch: control.sourceEpoch,
                paths: [],
            };
        });
        const index = Object.assign(new FakeVectorIndex(), { rankGraphCandidates });
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        const control: RankedPathRequestControl = {
            requestId: 'graph-diagnostic-forwarding',
            runEpoch: 'run-1',
            sourceEpoch: 'source-1',
            absoluteDeadlineMs: Date.now() + 10_000,
            maxPathsPerBatch: 16,
            maxCandidatePaths: 32,
            maxChunksScanned: 256,
        };
        const onDiagnostic = jest.fn();

        await expect(vss.rankGraphCandidates([1, 0], ['a.md'], control, { onDiagnostic }))
            .resolves.toMatchObject({ requestId: control.requestId });
        expect(rankGraphCandidates).toHaveBeenCalledWith(
            [1, 0],
            ['a.md'],
            control,
            { onDiagnostic },
        );
        expect(onDiagnostic).toHaveBeenCalledWith({
            state: 'cancel_requested',
            accepted: 0,
        });
    });

    it('exposes exact path evidence only when SQLite and the live vault source are current', async () => {
        const files = new Map([
            ['current.md', createTFile('current.md', { mtime: 10, size: 20 })],
            ['dirty.md', createTFile('dirty.md', { mtime: 10, size: 20 })],
            ['verify.md', createTFile('verify.md', { mtime: 10, size: 20 })],
            ['mismatch.md', createTFile('mismatch.md', { mtime: 11, size: 20 })],
            ['blocked.md', createTFile('blocked.md', { mtime: 10, size: 20 })],
            ['unknown.md', createTFile('unknown.md', { mtime: 10, size: 20 })],
        ]);
        const { plugin, mockVault } = createPlugin({
            isDataBoundaryAllowedPath: (path: string) => path !== 'blocked.md',
        });
        mockVault.getAbstractFileByPath.mockImplementation((path) => files.get(path) ?? null);
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex() as FakeVectorIndex & {
            getPathEvidenceGenerations: jest.Mock<
                (
                    paths: string[],
                    maxPathsPerBatch?: number,
                    maxChunksScanned?: number,
                ) => Promise<IndexedPathEvidenceGenerationResult>
            >;
        };
        index.getPathEvidenceGenerations = jest.fn(async (paths: string[]) => ({
            sourceEpoch: '9',
            paths: paths
                .filter((path) => path !== 'unknown.md')
                .map((path) => ({
                    path,
                    generation: `generation-${path}`,
                    contentHash: `hash-${path}`,
                    mtime: 10,
                    size: 20,
                })),
        }));
        Object.setPrototypeOf(index, MockSqliteVectorIndex.prototype);
        attachReadyIndex(vss, index);
        (vss as any).dirty.set('dirty.md', { first: 1, last: 1, epoch: 1 }); // eslint-disable-line @typescript-eslint/no-explicit-any
        (vss as any).verifyQueue.set('verify.md', { path: 'verify.md' }); // eslint-disable-line @typescript-eslint/no-explicit-any

        const result = await vss.getPathEvidenceGenerations([...files.keys()]);
        expect(result.sourceEpoch).toBe('9');
        expect(Object.fromEntries(result.paths.map((entry) => [entry.path, entry.reason]))).toEqual({
            'blocked.md': 'boundary_denied',
            'current.md': 'current',
            'dirty.md': 'dirty',
            'mismatch.md': 'source_revision_mismatch',
            'unknown.md': 'generation_unavailable',
            'verify.md': 'verification_pending',
        });
        expect(result.paths.find((entry) => entry.path === 'current.md')).toMatchObject({
            current: true,
            generation: 'generation-current.md',
        });
        expect(result.paths.filter((entry) => entry.path !== 'current.md').every((entry) => !entry.current)).toBe(true);
        expect(index.getPathEvidenceGenerations).toHaveBeenCalledWith(
            ['current.md', 'mismatch.md', 'unknown.md'],
            64,
            6_000,
        );
    });

    it('rebuilds lexical rows in released batches and lets foreground search run between batches', async () => {
        const files = [
            createTFile('a.md', { size: 1, mtime: 1, ctime: 1 }, 'md', 'a.md'),
            createTFile('b.md', { size: 1, mtime: 1, ctime: 1 }, 'md', 'b.md'),
        ];
        const { plugin } = createPlugin({
            getVSSFiles: jest.fn(() => files),
        });
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        index.blockFirstBatch = true;
        index.search.mockImplementation(async () => {
            index.operationOrder.push('search');
            return [];
        });
        attachReadyIndex(vss, index);
        const firstBatchStarted = index.waitForFirstBatch();

        const rebuilding = vss.rebuildLexicalIndex({ batchSize: 1 });
        await firstBatchStarted;
        const searching = vss.searchSimilarity('query');
        index.releaseFirstBatch();

        await searching;
        expect(index.operationOrder.slice(0, 2)).toEqual(['append-1', 'search']);
        await jest.runOnlyPendingTimersAsync();
        await expect(rebuilding).resolves.toMatchObject({
            aborted: false,
            rowsProcessed: 2,
            rowsTotal: 2,
            generation: 1,
        });
        expect(index.operationOrder).toEqual(['append-1', 'search', 'append-2']);
        expect(index.finalizeLexicalRebuild).toHaveBeenCalledTimes(1);
        expect((vss as any).aiUtils.createEmbeddings).toHaveBeenCalledTimes(1); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('aborts a lexical rebuild without activating the shadow generation', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        attachReadyIndex(vss, index);
        const controller = new AbortController();

        const rebuilding = vss.rebuildLexicalIndex({
            batchSize: 1,
            signal: controller.signal,
            onProgress: (event) => {
                if (event.lexicalRowsDone === 1) controller.abort();
            },
        });
        await jest.runOnlyPendingTimersAsync();

        await expect(rebuilding).resolves.toMatchObject({
            aborted: true,
            rowsProcessed: 1,
            rowsTotal: 2,
            reason: 'aborted',
        });
        expect(index.abortLexicalRebuild).toHaveBeenCalledTimes(1);
        expect(index.finalizeLexicalRebuild).not.toHaveBeenCalled();
        expect((vss as any).aiUtils.createEmbeddings).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('aborts a lexical rebuild when the live rollout flag is disabled mid-run', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        attachReadyIndex(vss, index);
        const phases: string[] = [];

        const rebuilding = vss.rebuildLexicalIndex({
            batchSize: 1,
            onProgress: (event) => {
                phases.push(event.phase);
                if (event.phase === 'lexical-rebuilding' && event.lexicalRowsDone === 1) {
                    plugin.settings.retrievalOptimizationFlags = { lexicalProfile: false };
                }
            },
        });
        await jest.runOnlyPendingTimersAsync();

        await expect(rebuilding).resolves.toMatchObject({
            aborted: true,
            rowsProcessed: 1,
            rowsTotal: 2,
            reason: 'feature_disabled',
        });
        expect(phases).toContain('cancelling');
        expect(index.abortLexicalRebuild).toHaveBeenCalledTimes(1);
        expect(index.finalizeLexicalRebuild).not.toHaveBeenCalled();
    });

    it('marks lexical activation as the cancel commit point before finalizing', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        attachReadyIndex(vss, index);
        const phases: string[] = [];

        const rebuilding = vss.rebuildLexicalIndex({
            batchSize: 2,
            onProgress: (event) => phases.push(event.phase),
        });
        await jest.runOnlyPendingTimersAsync();
        await rebuilding;

        expect(phases).toEqual([
            'lexical-rebuilding',
            'lexical-rebuilding',
            'lexical-rebuilding',
            'finalizing',
            'ready',
        ]);
    });

    it('enters shutdown synchronously and bounds a stalled maintenance drain', async () => {
        const { plugin } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        const neverSettles = new Promise<void>(() => undefined);

        const disposing = vss.disposeAfter(neverSettles);
        await expect(vss.searchSimilarity('late query')).resolves.toEqual([]);
        expect(index.search).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(750);
        await disposing;
        expect(index.dispose).toHaveBeenCalledTimes(1);
    });

    it('cleans an active lexical shadow before disposing during unload', async () => {
        const { plugin } = createPlugin();
        plugin.settings.retrievalOptimizationFlags = { lexicalProfile: true };
        const vss = new VSS(plugin, 'cache');
        const index = new FakeLexicalVectorIndex();
        index.blockFirstBatch = true;
        index.abortLexicalRebuild.mockImplementation(async () => {
            index.operationOrder.push('abort');
            return {
                state: 'awaiting_confirmation',
                reason: 'rebuild_aborted',
                chunkCount: 2,
                lexicalRowCount: 0,
            };
        });
        index.dispose.mockImplementation(async () => {
            index.operationOrder.push('dispose');
        });
        attachReadyIndex(vss, index);
        const controller = new AbortController();
        const firstBatchStarted = index.waitForFirstBatch();

        const rebuilding = vss.rebuildLexicalIndex({ batchSize: 1, signal: controller.signal });
        await firstBatchStarted;
        controller.abort();
        const disposing = vss.disposeAfter(rebuilding);
        index.releaseFirstBatch();
        await jest.advanceTimersByTimeAsync(0);

        await expect(rebuilding).resolves.toMatchObject({ aborted: true, reason: 'aborted' });
        await disposing;
        expect(index.abortLexicalRebuild).toHaveBeenCalledTimes(1);
        expect(index.operationOrder.indexOf('abort')).toBeLessThan(index.operationOrder.indexOf('dispose'));
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
        const { plugin, vssStateStore } = createPlugin();
        const staleIndex = new FakeVectorIndex();
        staleIndex.status = 'stale';
        setMockSqliteIndex(staleIndex);
        await vssStateStore.setMarker(createReadyMarker({
            profileSignature: 'openai||old-model|1024|COSINE',
            chunkCount: 10,
            fileCount: 4,
        }));
        const vss = new VSS(plugin, 'cache');

        await vss.initialize();
        const stats = await vss.getStats();

        expect(stats.status).toBe('stale');
        expect(staleIndex.initialize).not.toHaveBeenCalled();
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

    it('emits progress events during manual refresh', async () => {
        const { plugin, mockAdapter, mockVault } = createPlugin();
        const index = new FakeVectorIndex();
        const vss = new VSS(plugin, 'cache');
        const file = createTFile('refresh.md', { size: 20, mtime: 1, ctime: 1 }, 'md', 'refresh.md');
        attachReadyIndex(vss, index);
        (vss as any).waitForEmbeddingThrottle = jest.fn(async () => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
        plugin.getVSSFiles.mockReturnValue([file]);
        mockVault.getAbstractFileByPath.mockReturnValue(file);
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'refresh.md') return 'refresh memory';
            throw createMissingFileError();
        });
        const progressEvents: unknown[] = [];

        const summary = await vss.refreshLocalIndex({
            silent: true,
            onProgress: (event) => progressEvents.push(event),
        });

        expect(summary.updated).toBe(1);
        expect(progressEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ phase: 'scanning', filesTotal: 1, filesDone: 0 }),
            expect.objectContaining({ phase: 'writing', filesTotal: 1, filesDone: 1, filesUpdated: 1 }),
            expect.objectContaining({ phase: 'ready', filesTotal: 1, filesDone: 1, filesUpdated: 1 }),
        ]));
        vss.dispose();
    });

    it('reports missing-local-index when marker exists but local SQLite chunks are gone', async () => {
        const { plugin, vssStateStore } = createPlugin();
        const emptyIndex = new FakeVectorIndex();
        emptyIndex.status = 'ready';
        setMockSqliteIndex(emptyIndex);
        await vssStateStore.setMarker(createReadyMarker({ chunkCount: 8, fileCount: 3 }));
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

    it('rebuilds when the local marker schema is stale', async () => {
        const { plugin, vssStateStore } = createPlugin();
        const index = new FakeVectorIndex();
        setMockSqliteIndex(index);
        await vssStateStore.setMarker({
            ...createReadyMarker({ chunkCount: 8, fileCount: 3 }),
            schemaVersion: VSS_SCHEMA_VERSION - 1,
        });
        const vss = new VSS(plugin, 'cache');

        await vss.rebuildLocalIndex();
        const stats = await vss.getStats();

        expect(index.initialize).toHaveBeenCalled();
        expect(index.reset).toHaveBeenCalled();
        expect(stats.status).toBe('ready');
        expect(plugin.getVSSFiles).toHaveBeenCalled();
    });

    it('does not load legacy JSON fallback when SQLite is unavailable with old manifest/cache files', async () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
        const failingIndex = new FailingVectorIndex();
        setMockSqliteIndex(failingIndex);
        await vssStateStore.setMarker(createReadyMarker());
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
        expect(stats.status).toBe('disabled');
        expect(stats.fallbackMode).toBe(false);
        expect(stats.chunkCount).toBe(0);
        expect(results).toEqual([]);
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
    });

    it('does not embed the query or load legacy JSON on the foreground locked path', async () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
        const lockedIndex = new LockedVectorIndex();
        setMockSqliteIndex(lockedIndex);
        await vssStateStore.setMarker(createReadyMarker());
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
                    legacyJsonCacheBytes: 100,
                    updatedAt: '2026-05-02T00:00:00.000Z',
                });
            }
            throw createMissingFileError();
        });
        const vss = new VSS(plugin, 'cache');
        const createEmbeddings = (vss as any).aiUtils.createEmbeddings as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>; // eslint-disable-line @typescript-eslint/no-explicit-any

        const results = await vss.searchSimilarity('query');
        const stats = await vss.getStats();

        expect(results).toEqual([]);
        expect(stats.status).toBe('disabled');
        expect(stats.lastErrorCode).toBe('opfs-sahpool-locked');
        expect(createEmbeddings).not.toHaveBeenCalled();
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
        vss.dispose();
    });

    it('uses bounded manual retry for locked SQLite initialization', async () => {
        jest.useRealTimers();
        const { plugin } = createPlugin();
        const lockedIndex = new LockedVectorIndex();
        const recoveredIndex = new FakeVectorIndex();
        const indexes = [lockedIndex, recoveredIndex];
        (globalThis as { __mockSqliteVectorIndexFactory?: () => VectorIndex }).__mockSqliteVectorIndexFactory = () => indexes.shift() as VectorIndex;
        const vss = new VSS(plugin, 'cache');

        await vss.rebuildLocalIndex({ silent: true });
        const stats = await vss.getStats();

        expect(lockedIndex.dispose).toHaveBeenCalled();
        expect(recoveredIndex.initialize).toHaveBeenCalled();
        expect(stats.backend).toBe('sqlite-wasm-opfs-sahpool');
        expect(stats.status).toBe('ready');
        vss.dispose();
    });

    it('retries disabled foreground state from manual technical stats', async () => {
        const { plugin } = createPlugin();
        const recoveredIndex = new FakeVectorIndex();
        setMockSqliteIndex(recoveredIndex);
        const vss = new VSS(plugin, 'cache');
        (vss as any).initialized = true; // eslint-disable-line @typescript-eslint/no-explicit-any
        (vss as any).localStateReady = true; // eslint-disable-line @typescript-eslint/no-explicit-any
        (vss as any).deviceId = 'device-1'; // eslint-disable-line @typescript-eslint/no-explicit-any
        (vss as any).profile = { // eslint-disable-line @typescript-eslint/no-explicit-any
            provider: 'openai',
            baseURL: '',
            model: 'model',
            dimensions: 1024,
            distanceMetric: 'COSINE',
        };
        (vss as any).marker = { // eslint-disable-line @typescript-eslint/no-explicit-any
            schemaVersion: VSS_SCHEMA_VERSION,
            deviceId: 'device-1',
            indexId: 'index-1',
            profileSignature: 'openai||model|1024|COSINE',
            backend: 'sqlite-wasm-opfs-sahpool',
            chunkCount: 0,
            fileCount: 0,
            builtAt: '2026-05-02T00:00:00.000Z',
            lastVerifiedAt: '2026-05-02T00:00:00.000Z',
            storagePersisted: true,
        };
        (vss as any).status = 'disabled'; // eslint-disable-line @typescript-eslint/no-explicit-any

        const stats = await vss.getStats({ mode: 'manual' });

        expect(recoveredIndex.initialize).toHaveBeenCalled();
        expect(stats.status).toBe('ready');
        expect(stats.backend).toBe('sqlite-wasm-opfs-sahpool');
        vss.dispose();
    });

    it('retries locked marker recovery from manual technical stats when no marker exists', async () => {
        jest.useRealTimers();
        const { plugin } = createPlugin();
        const lockedIndex = new LockedVectorIndex();
        const recoveredIndex = new FakeVectorIndex();
        recoveredIndex.records.set('note.md', {
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 10,
            status: 'ready',
            updatedAt: 1,
        });
        const indexes = [lockedIndex, recoveredIndex];
        (globalThis as { __mockSqliteVectorIndexFactory?: () => VectorIndex }).__mockSqliteVectorIndexFactory = () => indexes.shift() as VectorIndex;
        const vss = new VSS(plugin, 'cache');

        const stats = await vss.getStats({ mode: 'manual' });

        expect(lockedIndex.dispose).toHaveBeenCalled();
        expect(recoveredIndex.initialize).toHaveBeenCalled();
        expect(stats.status).toBe('ready');
        expect(stats.chunkCount).toBe(1);
        expect(stats.databaseName).toMatch(/^personal-assistant-vss-Test_20Vault-[a-z0-9]+\.sqlite3$/);
        expect(stats.opfsDirectory).toMatch(/^\/personal-assistant-vss-v2\/Test_20Vault-[a-z0-9]+$/);
        expect(stats.opfsVfsName).toMatch(/^opfs-sahpool-Test_20Vault-[a-z0-9]+$/);
        vss.dispose();
    });

    it('disables VSS without scanning legacy JSON when SQLite is unavailable and no manifest exists', async () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
        const failingIndex = new FailingVectorIndex();
        setMockSqliteIndex(failingIndex);
        await vssStateStore.setMarker(createReadyMarker());
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
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
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
        await expect(vssStateStore.getMarker()).resolves.toMatchObject({ storagePersisted: false });
        expect(mockAdapter.write).not.toHaveBeenCalledWith(expect.stringContaining('/marker.json'), expect.any(String));
    });

    it('resets the local index, removes device state files, and releases the active backend', async () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
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
        await vssStateStore.setMarker(createReadyMarker({ chunkCount: 1, fileCount: 1 }));
        await vssStateStore.setDirtyJournal(new Map([['note.md', { first: 1, last: 2, epoch: 1 }]]));

        await vss.resetLocalIndex();
        const stats = await vss.getStats();

        expect(index.reset).toHaveBeenCalled();
        expect(index.dispose).toHaveBeenCalled();
        await expect(vssStateStore.getMarker()).resolves.toBeNull();
        await expect(vssStateStore.getDirtyJournal()).resolves.toEqual(new Map());
        expect(mockAdapter.remove).not.toHaveBeenCalledWith(expect.stringContaining('/marker.json'));
        expect(mockAdapter.remove).not.toHaveBeenCalledWith(expect.stringContaining('/manifest.json'));
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
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await vss.cleanLegacyJsonCache();

        expect(mockConfirmUserAction).toHaveBeenCalledWith(plugin.app, expect.objectContaining({
            title: 'Delete old Memory cache files?',
            message: expect.stringContaining('Delete 2 old memory cache files'),
        }));
        expect(mockConfirmUserAction).toHaveBeenCalledWith(plugin.app, expect.objectContaining({
            message: expect.stringContaining('Notes will not be changed or deleted'),
        }));
        expect(mockAdapter.remove).toHaveBeenCalledWith('cache/note.md.json');
        expect(mockAdapter.remove).toHaveBeenCalledWith('cache/other.md.json');
        expect(mockAdapter.remove).not.toHaveBeenCalledWith('cache/dirty.json');
    });

    it('does not clean legacy JSON if state changes while confirmation is open', async () => {
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
                    files: ['cache/note.md.json', 'cache/other.md.json'],
                    folders: [],
                };
            }
            return { files: [], folders: [] };
        });
        mockAdapter.read.mockImplementation(async (path) => {
            if (path === 'cache/note.md.json') return '12345';
            if (path === 'cache/other.md.json') return '1234567';
            throw createMissingFileError();
        });
        const confirmation = createDeferred<boolean>();
        mockConfirmUserAction.mockImplementation(() => confirmation.promise);
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        const cleanup = vss.cleanLegacyJsonCache();
        await Promise.resolve();
        await vss.resetLocalIndex();
        confirmation.resolve(true);
        await cleanup;

        expect(mockAdapter.remove).not.toHaveBeenCalledWith('cache/note.md.json');
        expect(mockAdapter.remove).not.toHaveBeenCalledWith('cache/other.md.json');
        expect(mockNoticeMessages).toContain('Old memory cache was not cleaned because diagnostic state changed.');
    });

    it('does not clean legacy JSON when SQLite stats are not safely ready', async () => {
        const { plugin, mockAdapter } = createPlugin();
        const index = new FakeVectorIndex();
        const vss = new VSS(plugin, 'cache');
        attachReadyIndex(vss, index);

        await vss.cleanLegacyJsonCache();

        expect(mockConfirmUserAction).not.toHaveBeenCalled();
        expect(mockAdapter.list).not.toHaveBeenCalledWith('cache');
        expect(mockAdapter.remove).not.toHaveBeenCalled();
    });
});


describe('fuseRRF', () => {
    it('scores a single-source result correctly', () => {
        const result = fuseRRF([[10, 20, 30]], 10);
        expect(result.size).toBe(3);
        expect(result.get(10)).toBeCloseTo(1 / (RRF_K + 1), 10);
        expect(result.get(20)).toBeCloseTo(1 / (RRF_K + 2), 10);
        expect(result.get(30)).toBeCloseTo(1 / (RRF_K + 3), 10);
    });

    it('boosts overlapping documents from two sources', () => {
        const result = fuseRRF([[10, 20], [20, 30]], 10);
        expect(result.get(20)).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 10);
        expect(result.get(10)).toBeCloseTo(1 / (RRF_K + 1), 10);
        expect(result.get(30)).toBeCloseTo(1 / (RRF_K + 2), 10);
    });

    it('ranks overlap above single-source rank-1 when both sources agree on rank-1', () => {
        const result = fuseRRF([[10, 20], [10, 30]], 10);
        const entries = [...result.entries()].sort(([, a], [, b]) => b - a);
        expect(entries[0][0]).toBe(10);
        expect(entries[0][1]).toBeCloseTo(2 / (RRF_K + 1), 10);
    });

    it('returns empty map for empty sources', () => {
        expect(fuseRRF([[], []], 10).size).toBe(0);
    });

    it('returns empty map for no sources', () => {
        expect(fuseRRF([], 10).size).toBe(0);
    });

    it('respects topK limit', () => {
        const result = fuseRRF([[1, 2, 3, 4, 5]], 3);
        expect(result.size).toBe(3);
        expect(result.has(1)).toBe(true);
        expect(result.has(2)).toBe(true);
        expect(result.has(3)).toBe(true);
        expect(result.has(4)).toBe(false);
    });

    it('preserves order by score in map iteration', () => {
        const result = fuseRRF([[10, 20], [20, 10]], 10);
        const ids = [...result.keys()];
        expect(ids[0]).toBe(10);
        expect(ids[1]).toBe(20);
        expect(result.get(10)).toBe(result.get(20));
    });

    it('handles single-source fallback (FTS returns nothing)', () => {
        const result = fuseRRF([[10, 20, 30], []], 10);
        expect(result.size).toBe(3);
        expect(result.get(10)).toBeCloseTo(1 / (RRF_K + 1), 10);
    });

    it('supports more than two sources', () => {
        const result = fuseRRF([[10], [10], [10]], 10);
        expect(result.get(10)).toBeCloseTo(3 / (RRF_K + 1), 10);
    });
});
