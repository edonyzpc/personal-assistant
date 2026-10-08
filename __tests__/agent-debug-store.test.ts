import { AgentDebugStore } from '../src/agent-debug/store';
import { AgentDebugService } from '../src/agent-debug/service';
import { projectDebugSession, utf8Bytes } from '../src/agent-debug/projection';
import { createListVaultTagsTool } from '../src/ai-services/chat-tool-factories';
import { DEFAULT_DEBUG_BUDGETS, type DebugBatch, type DebugGeneration, emptyDebugLineage } from '../src/agent-debug/types';

// A transactional, indexed fixture. Real browser durability remains an Obsidian smoke gate.
type Stored = Record<string, unknown>;
type Definition = { path: string | string[]; multi?: boolean };
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const compare = (left: unknown, right: unknown): number => {
    if (Array.isArray(left) && Array.isArray(right)) {
        for (let index = 0; index < Math.min(left.length, right.length); index++) { const result = compare(left[index], right[index]); if (result) return result; }
        return left.length - right.length;
    }
    return left === right ? 0 : left! < right! ? -1 : 1;
};
class Range {
    constructor(readonly lower?: unknown, readonly upper?: unknown, readonly lowerOpen = false, readonly upperOpen = false) {}
    static bound(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false): Range { return new Range(lower, upper, lowerOpen, upperOpen); }
    static upperBound(upper: unknown): Range { return new Range(undefined, upper); }
    includes(value: unknown): boolean {
        return (this.lower === undefined || (this.lowerOpen ? compare(value, this.lower) > 0 : compare(value, this.lower) >= 0))
            && (this.upper === undefined || (this.upperOpen ? compare(value, this.upper) < 0 : compare(value, this.upper) <= 0));
    }
}
class FixtureRequest<T> { result!: T; error = null; onsuccess?: () => void; onerror?: () => void; }
class Factory {
    rows = new Map<string, Map<string, Stored>>();
    definitions = new Map<string, Map<string, Definition>>();
    initialized = false;
    failCommit = false;
    readonly db = {
        objectStoreNames: { contains: (name: string) => this.rows.has(name) },
        createObjectStore: (name: string) => {
            this.rows.set(name, new Map()); this.definitions.set(name, new Map());
            return { createIndex: (id: string, path: string | string[], options?: { multiEntry: boolean }) => this.definitions.get(name)!.set(id, { path, multi: options?.multiEntry }) };
        },
        transaction: (names: string[], mode: string) => new Transaction(this, names, mode),
        close: () => undefined,
    };
    open(): unknown {
        const result = { result: this.db, onupgradeneeded: undefined as (() => void) | undefined, onsuccess: undefined as (() => void) | undefined };
        queueMicrotask(() => { if (!this.initialized) { result.onupgradeneeded?.(); this.initialized = true; } result.onsuccess?.(); });
        return result;
    }
}
class Transaction {
    oncomplete?: () => void; onabort?: () => void; onerror?: () => void;
    error: Error | null = null;
    private readonly rows: Map<string, Map<string, Stored>>;
    private timer?: ReturnType<typeof setTimeout>;
    private aborted = false;
    constructor(private readonly factory: Factory, private readonly names: string[], private readonly mode: string) {
        this.rows = new Map([...factory.rows].map(([name, rows]) => [name, new Map([...rows].map(([id, value]) => [id, copy(value)]))]));
    }
    abort(): void { this.aborted = true; if (this.timer) clearTimeout(this.timer); this.onabort?.(); }
    run<T>(operation: () => T): FixtureRequest<T> {
        if (this.timer) clearTimeout(this.timer);
        const result = new FixtureRequest<T>();
        queueMicrotask(() => {
            if (this.aborted) return;
            result.result = copy(operation()); result.onsuccess?.();
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                if (this.aborted) return;
                if (this.mode === 'readwrite' && this.factory.failCommit) { this.factory.failCommit = false; this.error = new Error('commit failure'); this.abort(); return; }
                if (this.mode === 'readwrite') for (const name of this.names) this.factory.rows.set(name, this.rows.get(name)!);
                this.oncomplete?.();
            }, 0);
        });
        return result;
    }
    objectStore(name: string): unknown {
        const rows = this.rows.get(name)!;
        const field = (row: Stored, path: string | string[]): unknown => Array.isArray(path) ? path.map(part => field(row, part))
            : path.split('.').reduce((value: unknown, part) => (value as Stored)?.[part], row);
        const index = (id: string) => {
            const definition = this.factory.definitions.get(name)!.get(id)!;
            const select = (query?: unknown): [string, Stored][] => [...rows].filter(([, row]) => {
                const value = field(row, definition.path);
                const matches = (candidate: unknown) => candidate !== undefined && (query === undefined || (query instanceof Range ? query.includes(candidate) : compare(candidate, query) === 0));
                return definition.multi && Array.isArray(value) ? value.some(matches) : matches(value);
            }).sort((left, right) => compare(field(left[1], definition.path), field(right[1], definition.path)));
            return {
                getAll: (query?: unknown, limit?: number) => this.run(() => select(query).slice(0, limit).map(([, row]) => row)),
                getAllKeys: (query?: unknown, limit?: number) => this.run(() => select(query).slice(0, limit).map(([key]) => key)),
                openCursor: (query?: unknown, direction?: string) => {
                    const selected = select(query); if (direction === 'prev') selected.reverse();
                    let position = 0;
                    const result = new FixtureRequest<unknown>();
                    const next = () => {
                        if (this.timer) clearTimeout(this.timer);
                        queueMicrotask(() => {
                            const row = selected[position++];
                            result.result = row ? { value: copy(row[1]), continue: next } : null;
                            result.onsuccess?.();
                            if (this.timer) clearTimeout(this.timer);
                            this.timer = setTimeout(() => this.oncomplete?.(), 0);
                        });
                    };
                    next(); return result;
                },
            };
        };
        return { get: (id: string) => this.run(() => rows.get(id)), put: (row: Stored) => this.run(() => { rows.set(String(row.id), copy(row)); return row.id; }),
            getAll: () => this.run(() => [...rows.values()]), delete: (query: string | Range) => this.run(() => {
                if (query instanceof Range) { for (const id of rows.keys()) if (query.includes(id)) rows.delete(id); }
                else rows.delete(query);
            }), index };
    }
}

function setup(vaultKey = 'vault-a', factory = new Factory(), now: () => number = () => 1000, budgets = {}): AgentDebugStore {
    return new AgentDebugStore({ vaultKey, indexedDB: factory as unknown as IDBFactory, keyRange: Range as unknown as typeof IDBKeyRange, now, budgets });
}
function batch(vaultKey: string, captureId: string, generation: DebugGeneration, time = 100): DebugBatch {
    return { generation,
        run: { vaultKey, captureId, runtimeRunId: captureId, conversationId: 'conversation', startedAt: time, updatedAt: time,
            endedAt: time + 1, expiresAt: 10000, status: 'completed', collection: 'complete', eventCount: 0, accountedBytes: 0, lastCommittedSeq: 0, hasGap: false },
        events: [{ vaultKey, captureId, seq: 1, segment: 0, nodeId: 'node', timestamp: time, kind: 'prompt', contentIds: ['body'] }],
        contents: [{ vaultKey, captureId, contentId: 'body', kind: 'prompt', text: 'private note', redactions: [], accountedBytes: 12,
            lineage: { ...emptyDebugLineage(), claimIds: ['claim'], possibleDomains: ['personal_memory'] }, generation: generation.generation, domainGenerations: { ...generation.domains } }],
    };
}

describe('Agent Debug storage boundaries', () => {
    it('persists a real 2.5 MiB tag-tool result between immediate start and finish and reopens all text', async () => {
        const prefix = Array.from({ length: 7 }, (_, index) => `${index}-${'folder'.repeat(16)}`).join('/');
        const files = Array.from({ length: 3000 }, (_, index) => ({ path: `${prefix}/note-${index}.md`, extension: 'md',
            basename: `note-${index}`, stat: { mtime: 1, size: 0 } }));
        const host = { settings: {}, log: jest.fn(), app: { vault: { getMarkdownFiles: () => files },
            metadataCache: { getFileCache: () => ({ tags: [{ tag: '#test' }] }) } } };
        const result = await createListVaultTagsTool().execute({ limit: 1 }, { host: host as never });
        const expected = projectDebugSession(result, DEFAULT_DEBUG_BUDGETS.runBytes).text!;
        expect(utf8Bytes(expected)).toBeGreaterThan(2.5 * 1024 * 1024);
        expect(utf8Bytes(expected)).toBeLessThan(DEFAULT_DEBUG_BUDGETS.runBytes);
        const factory = new Factory(); const store = setup('a', factory);
        const service = new AgentDebugService({ vaultKey: 'a', store, recoveryReady: true, enabled: () => true, now: () => 1000 });
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'tag-tool', kind: 'tool', phase: 'tool_result', toolOutput: result });
        recorder.finish('completed'); await service.flush();
        expect((await store.getRun(recorder.captureId))?.hasGap).toBe(false);
        await service.dispose();
        const reopened = setup('a', factory);
        const contents = (await reopened.getContents(recorder.captureId)).filter(content => content.kind === 'tool_output');
        expect(contents.map(content => content.text).join('')).toBe(expected);
        expect(contents.length).toBeGreaterThan(1);
        reopened.close();
    });

    it('saves 4096 deltas with 1900 observed paths without repeating path dependencies in every stored block', async () => {
        const sourcePaths = Array.from({ length: 1900 }, (_, index) => `notes/project-${Math.floor(index / 100)}/record-${index}.md`);
        expect(utf8Bytes(JSON.stringify(sourcePaths)) * 4096).toBeGreaterThan(DEFAULT_DEBUG_BUDGETS.runBytes);
        const factory = new Factory(); const store = setup('a', factory);
        const service = new AgentDebugService({ vaultKey: 'a', store, recoveryReady: true, enabled: () => true, now: () => 1000 });
        await service.initialize();
        const recorder = service.startRun({ conversationId: 'conversation', prompt: 'question', provider: 'p', model: 'm' });
        const delta = 'complete reply fragment content. ';
        for (let index = 0; index < 4096; index++) recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', text: delta,
            lineage: { sourcePaths, claimIds: ['claim'], legacyRecordIds: ['legacy'], domains: ['vault_notes'], unknown: false } });
        recorder.finish('completed'); await service.flush();
        expect((await store.getRun(recorder.captureId))?.hasGap).toBe(false);
        await service.dispose();
        const reopened = setup('a', factory);
        const contents = (await reopened.getContents(recorder.captureId)).filter(content => content.kind === 'output');
        expect(contents.map(content => content.text).join('')).toBe(delta.repeat(4096));
        expect(contents.every(content => content.lineage.sourceRefs.length === 0)).toBe(true);
        expect(contents[0].lineage).toEqual({ sourceRefs: [], claimIds: ['claim'], legacyRecordIds: ['legacy'],
            conversationIds: ['conversation'], possibleDomains: ['vault_notes'], completeness: 'known' });
        await reopened.forgetClaim('claim');
        expect((await reopened.getContents(recorder.captureId)).filter(content => content.kind === 'output')).toEqual([]);
        reopened.close();
    });

    it('reopens complete reasoning and actual tool text in its original order', async () => {
        const factory = new Factory(); const store = setup('a', factory);
        const recorded = batch('a', 'run', await store.getGeneration());
        recorded.run.contentVersion = 2;
        recorded.contents = (['input', 'reasoning', 'tool_input', 'tool_output', 'output'] as const).map((kind, index) => ({
            ...recorded.contents[0], contentId: `content-${index}`, kind, text: `${kind}: complete extracted text`,
        }));
        recorded.events[0].contentIds = recorded.contents.map(content => content.contentId);
        await store.writeBatch(recorded); store.close();
        const reopened = setup('a', factory);
        expect((await reopened.getContents('run', 'node')).map(content => content.kind)).toEqual(['input', 'reasoning', 'tool_input', 'tool_output', 'output']);
        expect((await reopened.getRun('run'))?.contentVersion).toBe(2);
        reopened.close();
    });
    it('isolates vault reads and preserves atomicity when a transaction fails', async () => {
        const factory = new Factory(); const a = setup('a', factory), b = setup('b', factory);
        await a.writeBatch(batch('a', 'run', await a.getGeneration()));
        expect(await b.listRuns()).toEqual([]);
        expect(await a.getContents('run', 'node')).toHaveLength(1);
        factory.failCommit = true;
        await expect(a.writeBatch(batch('a', 'failed', await a.getGeneration()))).rejects.toThrow();
        expect(await a.getRun('failed')).toBeUndefined();
        a.close(); b.close();
    });

    it('atomically deletes only the encoded run prefix across escaped IDs and segments, with rollback and late-write protection', async () => {
        const factory = new Factory();
        const vaultKey = 'vault"\\中文'; const captureId = 'run"\\回收';
        const a = setup(vaultKey, factory); const b = setup(`${vaultKey}-neighbor`, factory);
        const generation = await a.getGeneration();
        const target = batch(vaultKey, captureId, generation);
        target.contents = ['body"\\中文', 'body"\\中文-tail'].map(contentId => ({ ...target.contents[0], contentId }));
        target.events = [0, 1, 12].map(segment => ({ ...target.events[0], segment, contentIds: target.contents.map(content => content.contentId) }));
        await a.writeBatch(target);
        const neighbors = [`${captureId}-neighbor`, captureId.slice(0, -1), `${captureId}中文`];
        for (const id of neighbors) await a.writeBatch(batch(vaultKey, id, generation));
        await b.writeBatch(batch(b.vaultKey, captureId, await b.getGeneration()));

        factory.failCommit = true;
        await expect(a.invalidateConversation('conversation', { runIds: [captureId], operationId: 'delete-escaped' })).rejects.toThrow('commit failure');
        expect(await a.getContents(captureId)).toHaveLength(2);
        expect(await a.getEvents(captureId)).toHaveLength(3);
        expect(await a.isRunAllowed(target.run)).toBe(true);

        await a.invalidateConversation('conversation', { runIds: [captureId], operationId: 'delete-escaped' });
        expect(await a.getRun(captureId)).toBeUndefined();
        const runKey = JSON.stringify([vaultKey, captureId]);
        for (const name of ['events', 'contents']) {
            expect([...factory.rows.get(name)!.values()].filter(row => row.runKey === runKey)).toEqual([]);
        }
        for (const id of neighbors) {
            expect(await a.getContents(id)).toHaveLength(1);
            expect(await a.getEvents(id)).toHaveLength(1);
        }
        expect(await b.getContents(captureId)).toHaveLength(1);
        expect(await b.getEvents(captureId)).toHaveLength(1);
        await expect(a.writeBatch(target)).resolves.toBe(false);
        a.close(); b.close();
    });

    it('prevents old queued content after Forget and makes repeated cleanup idempotent across vaults', async () => {
        const factory = new Factory(); const a = setup('a', factory), b = setup('b', factory);
        const oldA = batch('a', 'a-run', await a.getGeneration());
        const oldB = batch('b', 'b-run', await b.getGeneration());
        await a.writeBatch(oldA); await b.writeBatch(oldB);
        await a.forgetClaim('claim', { deviceWide: true });
        const generation = await a.getGeneration();
        await a.forgetClaim('claim', { deviceWide: true });
        expect(await a.getGeneration()).toEqual(generation);
        await b.writeBatch(oldB);
        expect(await a.getContents('a-run')).toEqual([]);
        expect(await b.getContents('b-run')).toEqual([]);
        a.close(); b.close();
    });

    it('expires records without refreshing TTL on read and does not block a new run after a turn deletion', async () => {
        let now = 1000; const store = setup('a', new Factory(), () => now);
        const generation = await store.getGeneration();
        await store.writeBatch(batch('a', 'old', generation));
        await store.invalidateConversation('conversation', { runIds: ['old'], operationId: 'delete-one', permanent: false });
        expect((await store.getGeneration()).revision).toBe(1);
        expect(await store.isRunAllowed(batch('a', 'old', generation).run)).toBe(false);
        await store.writeBatch(batch('a', 'new', generation, 200));
        expect((await store.listRuns()).map(run => run.captureId)).toEqual(['new']);
        now = 10001;
        expect(await store.getContents('new')).toEqual([]);
        expect(await store.listRuns()).toEqual([]);
        await store.prune(); store.close();
    });

    it('retains actually recorded content from interrupted owners without source revalidation', async () => {
        const store = setup('a'); await store.beginOwner('owner-a');
        const old = batch('a', 'run', await store.getGeneration());
        old.run.ownerSessionId = 'owner-a';
        old.contents[0].lineage.possibleDomains = ['vault_notes'];
        await store.writeBatch(old);
        const clean = batch('a', 'clean', await store.getGeneration(), 200);
        clean.run.ownerSessionId = 'owner-clean';
        await store.writeBatch(clean);
        expect(await store.beginOwner('owner-b')).toBe(true);
        expect(await store.getContents('run')).toHaveLength(1);
        expect(await store.getEvents('run')).toEqual([expect.objectContaining({ contentIds: ['body'] })]);
        expect(await store.getContents('clean')).toHaveLength(1);
        const fresh = batch('a', 'fresh', await store.getGeneration(), 300);
        fresh.run.ownerSessionId = 'owner-b';
        fresh.contents[0].lineage.possibleDomains = ['vault_notes'];
        expect(await store.writeBatch(fresh)).toBe(true);
        expect(await store.getContents('fresh')).toHaveLength(1);
        expect((await store.status()).recoveryReady).toBe(true);
        expect(await store.listRuns()).toHaveLength(3);
        store.close();
    });

    it('evicts the oldest ended run to make room for the newest run', async () => {
        const store = setup('a'); const generation = await store.getGeneration();
        await store.writeBatch(batch('a', 'oldest', generation, 100));
        const bytes = (await store.status()).bytes;
        store.budgets.persistentBytes = bytes * 2 + 200;
        await store.writeBatch(batch('a', 'middle', generation, 200));
        await store.writeBatch(batch('a', 'latest', generation, 300));
        expect(await store.getRun('oldest')).toBeUndefined();
        expect(await store.getContents('latest')).toHaveLength(1);
        expect((await store.status()).bytes).toBeLessThanOrEqual(store.budgets.persistentBytes);
        store.close();
    });

    it('persists a nonpermanent cutoff so an old uncommitted run cannot return', async () => {
        const store = setup('a'); const generation = await store.getGeneration();
        await store.invalidateConversation('conversation', { before: 200, permanent: false });
        await expect(store.writeBatch(batch('a', 'late-old', generation, 100))).resolves.toBe(false);
        await expect(store.writeBatch(batch('a', 'new', generation, 201))).resolves.toBe(true);
        store.close();
    });

    it('reclaims expired deletion controls while refusing content from runs beyond retention', async () => {
        let now = 1000; const factory = new Factory(); const store = setup('a', factory, () => now, { retentionMs: 500 });
        const generation = await store.getGeneration();
        await store.invalidateConversation('conversation', { before: 1000, operationId: 'delete' });
        const controlsBefore = factory.rows.get('control')!.size;
        now = 1600; await store.prune();
        expect(factory.rows.get('control')!.size).toBeLessThan(controlsBefore);
        await expect(store.writeBatch(batch('a', 'late', generation, 1000))).resolves.toBe(false);
        store.close();
    });
});
