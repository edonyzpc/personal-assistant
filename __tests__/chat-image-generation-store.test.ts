import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
    CHAT_HISTORY_IDB_VERSION, IndexedDbChatHistoryStore, MemoryChatHistoryStore,
    type ChatHistoryStore,
} from '../src/chat/chat-history-store';
import type { GeneratedImageVersion, ImageGenerationTask } from '../src/chat/image-generation-types';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';

const now = '2026-09-18T12:00:00.000Z';
const later = '2026-09-18T12:01:00.000Z';
const imageRef = { assetId: 'generated_one', contentHash: 'a'.repeat(64) };

function task(overrides: Partial<ImageGenerationTask> = {}): ImageGenerationTask {
    return {
        schemaVersion: 1, taskId: 'task_one', operationId: 'operation_one', conversationId: 'conversation_one',
        stableMessageId: 'message_one', createdAt: now, updatedAt: now, revision: 0,
        request: { userPrompt: 'A red bird', submittedPrompt: 'A red bird', operation: 'generate', model: 'wan2.7-image',
            count: 1, inputRefs: [] },
        connection: { mode: 'dedicated-wan', endpointIdentity: 'dashscope-cn', credentialSlot: 'image-key', revision: 1 },
        state: 'prepared', outputs: [], ...overrides,
    };
}

function version(overrides: Partial<GeneratedImageVersion> = {}): GeneratedImageVersion {
    return { schemaVersion: 1, versionId: 'version_one', taskId: 'task_one', outputId: 'output_one',
        assetRef: imageRef, inputRefs: [], createdAt: later, model: 'wan2.7-image', submittedPrompt: 'A red bird',
        ...overrides };
}

class FakeRequest<T> {
    onsuccess: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;
    onblocked: ((event: Event) => void) | null = null;
    error: Error | null = null;
    constructor(public result: T) {}
}

function request<T>(value: T): IDBRequest<T> {
    const result = new FakeRequest(value);
    queueMicrotask(() => result.onsuccess?.({} as Event));
    return result as unknown as IDBRequest<T>;
}

class FakeDatabase {
    readonly keyPaths = new Map<string, string>();
    readonly stores = new Map<string, Map<string, unknown>>([
        ['conversations', new Map()], ['turns', new Map()], ['metadata', new Map()],
        ['assets', new Map()], ['variants', new Map()], ['writingVersions', new Map()], ['saveReceipts', new Map()],
    ]);
    onversionchange: ((event: IDBVersionChangeEvent) => void) | null = null;
    readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

    createObjectStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore {
        const values = new Map<string, unknown>();
        this.stores.set(name, values);
        if (typeof options?.keyPath === 'string') this.keyPaths.set(name, options.keyPath);
        return new FakeObjectStore(values) as unknown as IDBObjectStore;
    }
    transaction(names: string | string[]): IDBTransaction {
        const allowed = Array.isArray(names) ? names : [names];
        return new FakeTransaction(this, allowed) as unknown as IDBTransaction;
    }
    close(): void {}
}

class FakeObjectStore {
    constructor(private readonly values: Map<string, unknown>) {}
    get(key: IDBValidKey): IDBRequest<unknown> { return request(structuredClone(this.values.get(String(key)))); }
    getAll(): IDBRequest<unknown[]> { return request([...this.values.values()].map((value) => structuredClone(value))); }
    getAllKeys(): IDBRequest<IDBValidKey[]> { return request<IDBValidKey[]>([...this.values.keys()]); }
    put(value: Record<string, unknown>): IDBRequest<IDBValidKey> {
        const key = value.id ?? value.key ?? value.versionId ?? value.taskId;
        if (typeof key !== 'string') throw new Error('Missing fake key');
        this.values.set(key, structuredClone(value));
        return request<IDBValidKey>(key);
    }
    delete(key: IDBValidKey): IDBRequest<undefined> { this.values.delete(String(key)); return request(undefined); }
}

class FakeTransaction {
    oncomplete: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onabort: ((event: Event) => void) | null = null;
    error: Error | null = null;
    private done = false;
    private readonly snapshots: Map<string, Map<string, unknown>>;

    constructor(private readonly db: FakeDatabase, private readonly allowed: string[]) {
        this.snapshots = new Map(allowed.map((name) => [name, new Map(db.stores.get(name))]));
        setImmediate(() => { if (!this.done) { this.done = true; this.oncomplete?.({} as Event); } });
    }
    objectStore(name: string): IDBObjectStore {
        if (!this.allowed.includes(name)) throw new Error(`Store ${name} outside transaction`);
        return new FakeObjectStore(this.db.stores.get(name)!) as unknown as IDBObjectStore;
    }
    abort(): void {
        if (this.done) throw new Error('Transaction complete');
        this.done = true;
        for (const [name, snapshot] of this.snapshots) this.db.stores.set(name, snapshot);
        this.onabort?.({} as Event);
    }
}

class FakeFactory {
    readonly db = new FakeDatabase();
    version = 2;
    open(_name: string, version?: number): IDBOpenDBRequest {
        const result = new FakeRequest(this.db);
        queueMicrotask(() => {
            if ((version ?? 0) > this.version) {
                result.onupgradeneeded?.({} as IDBVersionChangeEvent);
                this.version = version!;
            }
            result.onsuccess?.({} as Event);
        });
        return result as unknown as IDBOpenDBRequest;
    }
}

const originalKeyRange = globalThis.IDBKeyRange;
beforeAll(() => {
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: {
        bound: (lower: string, upper: string) => ({ lower, upper }),
    } });
});
afterAll(() => {
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: originalKeyRange });
});

it('leaves image history unavailable when IndexedDB cannot open instead of accepting an ephemeral task', async () => {
    const factory = { open: () => {
        const result = new FakeRequest(null as unknown as IDBDatabase);
        queueMicrotask(() => {
            result.error = new Error('storage unavailable');
            result.onerror?.({} as Event);
        });
        return result as unknown as IDBOpenDBRequest;
    } } as unknown as IDBFactory;
    const store = new IndexedDbChatHistoryStore('unwritable-image-task-test', factory);
    await expect(store.initialize()).rejects.toThrow('storage unavailable');
    await expect(store.putImageGenerationTask(task())).rejects.toThrow();
});

describe.each(['memory', 'indexeddb'] as const)('image generation task store (%s)', (backend) => {
    async function open(): Promise<{ store: ChatHistoryStore; factory?: FakeFactory }> {
        if (backend === 'memory') {
            const store = new MemoryChatHistoryStore();
            await store.initialize();
            await store.upsertConversation({ id: 'conversation_one', title: 'Images', createdAt: now,
                updatedAt: now, turnCount: 0, preview: '' });
            return { store };
        }
        const factory = new FakeFactory();
        const store = new IndexedDbChatHistoryStore('image-task-test', factory as unknown as IDBFactory);
        await store.initialize();
        await store.upsertConversation({ id: 'conversation_one', title: 'Images', createdAt: now,
            updatedAt: now, turnCount: 0, preview: '' });
        return { store, factory };
    }

    it('forgets only the task owned by a deleted message', async () => {
        const { store } = await open();
        await store.putImageGenerationTask(task());
        await store.putImageGenerationTask(task({ taskId: 'task_two', operationId: 'operation_two',
            stableMessageId: 'message_two' }));
        await store.appendTurn({ conversationId: 'conversation_one', turnIndex: 0,
            user: { role: 'user', content: 'Create one', hostProvenance: {
                version: 1, messageId: 'message_one', kind: 'ordinary_user_statement' } },
            assistant: { role: 'assistant', content: 'Started' } });
        await store.deleteTurn('conversation_one', 0);
        await expect(store.getImageGenerationTask('task_one')).resolves.toBeNull();
        await expect(store.getImageGenerationTaskByOperationId('operation_one')).resolves.toBeNull();
        await expect(store.getImageGenerationTask('task_two')).resolves.toMatchObject({ state: 'prepared' });
        expect((await store.getImageGenerationTask('task_two'))?.deliverySuppressed).toBeUndefined();
    });

    it('keeps earlier image tasks when later chat turns are removed', async () => {
        const { store } = await open();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        await store.putImageGenerationTask(task());
        await store.putImageGenerationTask(task({ taskId: 'task_two', operationId: 'operation_two',
            stableMessageId: 'message_two' }));
        for (let index = 0; index < 2; index++) {
            await store.appendTurn({ conversationId: 'conversation_one', turnIndex: index,
                user: { role: 'user', content: `Create ${index}`, hostProvenance: {
                    version: 1, messageId: index ? 'message_two' : 'message_one', kind: 'ordinary_user_statement' } },
                assistant: { role: 'assistant', content: 'Started' } });
        }
        await manager.removeTurnsFromIndex('conversation_one', 1);
        expect(await store.getImageGenerationTask('task_one')).not.toBeNull();
        expect(await store.getImageGenerationTask('task_two')).toBeNull();
    });

    it('reserves the operation and permits only one durable submission claim', async () => {
        const { store, factory } = await open();
        if (factory) {
            expect(factory.version).toBe(CHAT_HISTORY_IDB_VERSION);
            expect(factory.db.stores.has('imageGenerationTasks')).toBe(true);
            expect(factory.db.keyPaths.get('imageGenerationTasks')).toBe('taskId');
            expect(factory.db.keyPaths.get('generatedImageVersions')).toBe('versionId');
        }
        const prepared = task();
        await store.putImageGenerationTask(prepared);
        prepared.request.userPrompt = 'mutated';
        expect((await store.getImageGenerationTaskByOperationId('operation_one'))?.request.userPrompt).toBe('A red bird');
        await expect(store.putImageGenerationTask(task({ taskId: 'task_two' }))).rejects.toThrow('operation');
        await expect(store.putImageGenerationTask(task({ taskId: 'task_three', operationId: 'operation_three',
            state: 'submitting' }))).rejects.toThrow('prepared');
        await expect(store.putImageGenerationTask(task({ revision: 1, state: 'submitting', updatedAt: later }), 0))
            .rejects.toThrow('claim');

        const claimed = await store.claimImageGenerationSubmission('task_one', 0, later);
        expect(claimed).toMatchObject({ state: 'submitting', revision: 1 });
        await expect(store.claimImageGenerationSubmission('task_one', 0, later)).resolves.toBeNull();
        await expect(store.putImageGenerationTask({ ...claimed!, state: 'running', revision: 2 }, 0))
            .rejects.toThrow('revision');
        expect((await store.getImageGenerationTask('task_one'))?.state).toBe('submitting');
    });

    it('binds saved versions to outputs and forgets their metadata after chat deletion', async () => {
        const { store } = await open();
        await store.putImageGenerationTask(task());
        const claimed = (await store.claimImageGenerationSubmission('task_one', 0, later))!;
        await store.putImageGenerationTask({ ...claimed, state: 'saving', revision: 2,
            outputs: [{ outputId: 'output_one', providerOrdinal: 0, saveState: 'saved', assetRef: imageRef }] }, 1);
        await expect(store.putGeneratedImageVersion(version({ outputId: 'other' }))).rejects.toThrow('saved task output');
        await store.putGeneratedImageVersion(version());
        await expect(store.putGeneratedImageVersion(version({ versionId: 'version_two' }))).rejects.toThrow('already has a version');
        const read = await store.getGeneratedImageVersion('version_one');
        read!.submittedPrompt = 'mutated';
        expect((await store.getGeneratedImageVersion('version_one'))?.submittedPrompt).toBe('A red bird');

        await store.deleteTurnsForConversation('conversation_one');
        expect(await store.getImageGenerationTask('task_one')).toBeNull();
        expect(await store.getImageGenerationTaskByOperationId('operation_one')).toBeNull();
        expect(await store.listGeneratedImageVersions('task_one')).toHaveLength(0);
        await store.deleteConversation('conversation_one');
        await expect(store.putImageGenerationTask(task())).rejects.toThrow('conversation is unavailable');
    });

    it('rejects unknown persisted state rather than pretending the task is resumable', async () => {
        const { store, factory } = await open();
        if (!factory) return;
        factory.db.stores.get('imageGenerationTasks')!.set('task_one', { ...task(), state: 'unknown_future_state' });
        await expect(store.getImageGenerationTask('task_one')).rejects.toThrow('Unsupported image generation task');
    });

    it('isolates damaged records and removes those belonging to a deleted chat', async () => {
        const { store, factory } = await open();
        if (!factory) return;
        const taskRecords = factory.db.stores.get('imageGenerationTasks')!;
        taskRecords.set('task_bad', { ...task({ taskId: 'task_bad', operationId: 'operation_bad',
            conversationId: 'another_conversation' }), state: 'unknown_future_state' });
        await store.putImageGenerationTask(task());
        expect((await store.listImageGenerationTasks()).map((entry) => entry.taskId)).toEqual(['task_one']);
        await expect(store.putImageGenerationTask(task({ taskId: 'task_conflict', operationId: 'operation_bad' })))
            .rejects.toThrow('operation');
        const claimed = (await store.claimImageGenerationSubmission('task_one', 0, later))!;
        await store.putImageGenerationTask({ ...claimed, state: 'saving', revision: 2,
            outputs: [{ outputId: 'output_one', providerOrdinal: 0, saveState: 'saved', assetRef: imageRef }] }, 1);
        const versionRecords = factory.db.stores.get('generatedImageVersions')!;
        versionRecords.set('version_bad', { ...version({ versionId: 'version_bad' }), schemaVersion: 99 });
        await expect(store.putGeneratedImageVersion(version())).rejects.toThrow('Damaged generated image version');
        factory.db.stores.get('generatedImageVersions')!.delete('version_bad');
        await store.putGeneratedImageVersion(version());
        factory.db.stores.get('generatedImageVersions')!.set('version_bad', {
            ...version({ versionId: 'version_bad', taskId: 'another_task' }), schemaVersion: 99 });
        expect((await store.listGeneratedImageVersions('task_one')).map((entry) => entry.versionId)).toEqual(['version_one']);
        factory.db.stores.get('imageGenerationTasks')!.set('task_bad_same_conversation', { ...task({ taskId: 'task_bad_same_conversation',
            operationId: 'operation_bad_same' }), state: 'unknown_future_state' });
        await store.deleteConversation('conversation_one');
        expect(factory.db.stores.get('imageGenerationTasks')!.has('task_bad')).toBe(true);
        expect(factory.db.stores.get('imageGenerationTasks')!.has('task_bad_same_conversation')).toBe(false);
        expect(factory.db.stores.get('generatedImageVersions')!.has('version_bad')).toBe(true);
    });
});
