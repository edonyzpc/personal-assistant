import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { VSS } from '../src/vss';
import { computeContentHash, DirtyTimestamps } from '../src/vss-helpers';
import { TFile } from 'obsidian';
import { VSS_SCHEMA_VERSION, type EmbeddingProfile, type VectorIndex, type VectorIndexStatus, type VectorSearchResult, type VSSChunk, type VSSFileRecord, type VSSFileState, type VSSIndexMarker, type VSSIndexStats } from '../src/vss/types';
import { fuseRRF, RRF_K } from '../src/vss/rrf';
import { MemoryVSSIndexStateStore } from '../src/vss/local-state-store';
import { getVSSDeviceId } from '../src/vss/state';

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
        Platform: { isMobile: false },
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

class FakeVectorIndex implements VectorIndex {
    status: VectorIndexStatus = 'ready';
    records = new Map<string, VSSFileRecord>();
    deleteFile = jest.fn<(path: string) => Promise<void>>(async (path) => {
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
        const { plugin, mockAdapter, mockVault, vssStateStore } = createPlugin();
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
        expect(index.deleteFile).toHaveBeenCalledWith('large.md');
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
        expect(index.deleteFile).toHaveBeenCalledWith('deleted.md');
        expect(index.records.has('deleted.md')).toBe(false);
        expect(index.upsertFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'keep.md' }), expect.any(Array), expect.any(Array));
    });

    it('removes stale index entries when cleaned markdown content is empty or blank', async () => {
        const { plugin, mockAdapter, vssStateStore } = createPlugin();
        const vss = new VSS(plugin, 'cache');
        const index = new FakeVectorIndex();
        attachReadyIndex(vss, index);
        mockAdapter.read.mockResolvedValue('\n\n');
        const emptyFile = createTFile('empty.md', { size: 2, mtime: Date.now(), ctime: Date.now() }, 'md', 'empty.md');

        const status = await vss.refreshFileCache(emptyFile);

        expect(status).toBe('removed');
        expect(index.deleteFile).toHaveBeenCalledWith('empty.md');
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
        expect(index.deleteFile).toHaveBeenCalledWith('deleted.md');
        const persistedDirty = await vssStateStore.getDirtyJournal();
        expect(persistedDirty.has('created.md')).toBe(true);
        expect(persistedDirty.has('changed.md')).toBe(false);
        expect(mockAdapter.write).not.toHaveBeenCalledWith('cache/dirty.json', expect.any(String));
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
        const contentHash = await computeContentHash('same content');
        const { plugin, mockVault } = createPlugin({
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
        (vss as any).computeFileHash = jest.fn(async () => { // eslint-disable-line @typescript-eslint/no-explicit-any
            (vss as any).markDirtyPath('race.md', now + 100); // eslint-disable-line @typescript-eslint/no-explicit-any
            return { hash: contentHash, tooLarge: false };
        });

        const summary = await vss.verifyPendingChanges();

        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(summary.metadataSynced).toBe(0);
        expect(dirtyMap.has('race.md')).toBe(true);
        expect(index.updateFileMetadata).not.toHaveBeenCalled();
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
