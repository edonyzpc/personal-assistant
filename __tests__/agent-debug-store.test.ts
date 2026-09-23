import { AgentDebugStore } from '../src/agent-debug/store';
import { type DebugBatch, type DebugGeneration, emptyDebugLineage } from '../src/agent-debug/types';

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
    constructor(readonly lower?: unknown, readonly upper?: unknown) {}
    static bound(lower: unknown, upper: unknown): Range { return new Range(lower, upper); }
    static upperBound(upper: unknown): Range { return new Range(undefined, upper); }
    includes(value: unknown): boolean { return (this.lower === undefined || compare(value, this.lower) >= 0) && (this.upper === undefined || compare(value, this.upper) <= 0); }
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
            getAll: () => this.run(() => [...rows.values()]), delete: (id: string) => this.run(() => rows.delete(id)), index };
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

    it('hides uncertain note content without disabling new capture or clean history', async () => {
        const store = setup('a'); await store.beginOwner('owner-a');
        const old = batch('a', 'run', await store.getGeneration());
        old.run.ownerSessionId = 'owner-a';
        old.contents[0].lineage.possibleDomains = ['vault_notes'];
        await store.writeBatch(old);
        const clean = batch('a', 'clean', await store.getGeneration(), 200);
        clean.run.ownerSessionId = 'owner-clean';
        await store.writeBatch(clean);
        expect(await store.beginOwner('owner-b')).toBe(true);
        expect(await store.getContents('run')).toEqual([]);
        expect(await store.getEvents('run')).toEqual([expect.objectContaining({ availability: 'recovery_unverified', contentIds: [] })]);
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
