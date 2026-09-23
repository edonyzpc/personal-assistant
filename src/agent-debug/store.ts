import { getPlatformIndexedDB, getPlatformIDBKeyRange, setPlatformTimeout, clearPlatformTimeout } from '../platform-dom';
import { DEFAULT_DEBUG_BUDGETS, DEBUG_DOMAINS, type DebugBatch, type DebugBudgets, type DebugContent,
    type DebugDomain, type DebugEvent, type DebugEventQuery, type DebugGeneration, type DebugRun,
    type DebugRunQuery, type DebugStoreStatus } from './types';
import { utf8Bytes } from './projection';

const STORES = ['runs', 'events', 'contents', 'control'] as const;
type StoreName = typeof STORES[number];
interface Row<T> { id: string; vaultKey: string; runKey: string; value: T; bytes: number; }
interface RunRow extends Row<DebugRun> { startedAt: number; expiresAt: number; }
interface ContentRow extends Row<DebugContent> { claims: string[]; legacy: string[]; domains: string[]; unknownDomains: string[]; }
interface ControlRow { id: string; value: number | string | boolean; expiresAt?: number; }

export interface AgentDebugStoreOptions {
    vaultKey: string;
    indexedDB?: IDBFactory;
    keyRange?: typeof IDBKeyRange;
    dbName?: string;
    now?: () => number;
    budgets?: Partial<DebugBudgets>;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error ?? new Error('Debug storage request failed'));
    });
}

function complete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Debug transaction failed'));
    });
}

const key = (...parts: unknown[]): string => JSON.stringify(parts);
const rowBytes = (value: unknown): number => utf8Bytes(JSON.stringify(value)) + 256;

/** Device-local database. Ordinary operations are permanently bound to one vault. */
export class AgentDebugStore {
    private database: IDBDatabase | undefined;
    private opening: Promise<void> | undefined;
    private closed = false;
    private readonly indexedDB: IDBFactory | undefined;
    private readonly ranges: typeof IDBKeyRange | undefined;
    readonly vaultKey: string;
    readonly budgets: DebugBudgets;
    private readonly now: () => number;
    private readonly dbName: string;
    private readonly dirtyControl = new WeakSet<IDBTransaction>();

    constructor(options: AgentDebugStoreOptions) {
        this.vaultKey = options.vaultKey;
        this.indexedDB = options.indexedDB ?? getPlatformIndexedDB();
        this.ranges = options.keyRange ?? getPlatformIDBKeyRange();
        this.dbName = options.dbName ?? 'personal-assistant-agent-debug-v1';
        this.now = options.now ?? Date.now;
        this.budgets = { ...DEFAULT_DEBUG_BUDGETS, ...options.budgets };
    }

    async initialize(): Promise<void> {
        if (this.database) return;
        if (this.closed || !this.vaultKey || !this.indexedDB || !this.ranges) throw new Error('Debug storage unavailable');
        if (!this.opening) this.opening = new Promise<void>((resolve, reject) => {
            const opened = this.indexedDB!.open(this.dbName, 1);
            let settled = false;
            const timeout = setPlatformTimeout(() => fail(new Error('Debug storage open timeout')), 2000);
            const fail = (error: Error): void => {
                if (settled) return;
                settled = true; clearPlatformTimeout(timeout); reject(error);
            };
            opened.onupgradeneeded = () => {
                const db = opened.result;
                for (const name of STORES) {
                    if (db.objectStoreNames.contains(name)) continue;
                    const store = db.createObjectStore(name, { keyPath: 'id' });
                    if (name === 'control') { store.createIndex('expires', 'expiresAt'); continue; }
                    store.createIndex('vault', 'vaultKey');
                    store.createIndex('run', 'runKey');
                    if (name === 'runs') {
                        store.createIndex('started', ['vaultKey', 'startedAt', 'id']);
                        store.createIndex('expires', 'expiresAt');
                    }
                    if (name === 'events') store.createIndex('sequence', ['runKey', 'value.seq']);
                    if (name === 'contents') {
                        store.createIndex('claims', 'claims', { multiEntry: true });
                        store.createIndex('legacy', 'legacy', { multiEntry: true });
                        store.createIndex('domains', 'domains', { multiEntry: true });
                        store.createIndex('unknownDomains', 'unknownDomains', { multiEntry: true });
                    }
                }
            };
            opened.onerror = () => fail(opened.error ?? new Error('Debug storage open failed'));
            opened.onblocked = () => fail(new Error('Debug storage upgrade blocked'));
            opened.onsuccess = () => {
                if (settled || this.closed) { opened.result.close(); return; }
                settled = true; clearPlatformTimeout(timeout);
                this.database = opened.result;
                this.database.onversionchange = () => { this.database?.close(); this.database = undefined; this.closed = true; };
                resolve();
            };
        }).catch(error => { this.opening = undefined; throw error; });
        await this.opening;
    }

    private async transact<T>(names: StoreName[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
        await this.initialize();
        const tx = this.database!.transaction(names, mode);
        const completion = complete(tx);
        // An abort can happen while operation is awaiting a request; attach immediately.
        void completion.catch(() => undefined);
        try {
            const result = await operation(tx);
            if (this.dirtyControl.has(tx)) {
                const rows = await request(tx.objectStore('control').getAll()) as ControlRow[];
                const bytes = rows.reduce((total, row) => total + rowBytes(row), 128);
                // These compact governance markers have no content and cannot grow without a hard bound.
                if (bytes > Math.min(4 * 1024 * 1024, this.budgets.persistentBytes)) throw new Error('Debug control capacity');
                tx.objectStore('control').put({ id: key('control-bytes'), value: bytes });
            }
            await completion; return result;
        }
        catch (error) { try { tx.abort(); } catch { /* Already finished. */ } await completion.catch(() => undefined); throw error; }
    }

    private async control(tx: IDBTransaction, id: string): Promise<ControlRow['value'] | undefined> {
        const row = await request(tx.objectStore('control').get(id)) as ControlRow | undefined;
        return row?.expiresAt !== undefined && row.expiresAt <= this.now() ? undefined : row?.value;
    }
    private putControl(tx: IDBTransaction, id: string, value: ControlRow['value']): void {
        const type = (JSON.parse(id) as string[])[0];
        const expiresAt = ['claim', 'legacy', 'conversation', 'conversation-cutoff', 'run', 'applied', 'uncertain-owner'].includes(type)
            ? this.now() + this.budgets.retentionMs : undefined;
        tx.objectStore('control').put({ id, value, expiresAt }); this.dirtyControl.add(tx);
    }
    private async generation(tx: IDBTransaction, vaultKey = this.vaultKey): Promise<DebugGeneration> {
        const domains: Partial<Record<DebugDomain, number>> = {};
        for (const domain of DEBUG_DOMAINS) {
            domains[domain] = Number(await this.control(tx, key('domain', vaultKey, domain)) ?? 0)
                + Number(await this.control(tx, key('domain', '*', domain)) ?? 0);
        }
        return { generation: Number(await this.control(tx, key('generation', vaultKey)) ?? 0), domains,
            revision: Number(await this.control(tx, key('revision', vaultKey)) ?? 0),
            sourceToken: await this.control(tx, key('source-token', vaultKey)) as string | undefined,
            quarantined: await this.control(tx, key('quarantine', vaultKey)) === true };
    }
    getGeneration(): Promise<DebugGeneration> { return this.transact(['control'], 'readonly', tx => this.generation(tx)); }

    private async runAllowed(tx: IDBTransaction, run: DebugRun): Promise<boolean> {
        if (run.conversationId && await this.control(tx, key('conversation', this.vaultKey, run.conversationId))) return false;
        if (run.conversationId) {
            const cutoff = await this.control(tx, key('conversation-cutoff', this.vaultKey, run.conversationId));
            if (typeof cutoff === 'number' && run.startedAt <= cutoff) return false;
        }
        return !await this.control(tx, key('run', this.vaultKey, run.runtimeRunId ?? run.captureId));
    }
    isRunAllowed(run: DebugRun): Promise<boolean> {
        if (run.vaultKey !== this.vaultKey) return Promise.resolve(false);
        return this.transact(['control'], 'readonly', tx => this.runAllowed(tx, run));
    }

    getOwners(): Promise<string[]> {
        return this.transact(['control'], 'readonly', async tx => this.ownerIds(await this.control(tx, key('owner', this.vaultKey))));
    }

    private ownerIds(value: unknown): string[] {
        if (typeof value !== 'string') return [];
        try { const result: unknown = JSON.parse(value); return Array.isArray(result) ? result.filter((item): item is string => typeof item === 'string') : [value]; }
        catch { return [value]; }
    }

    beginOwner(ownerId: string, liveOwners: readonly string[] = []): Promise<boolean> {
        return this.transact(['runs', 'control'], 'readwrite', async tx => {
            const existing = await this.control(tx, key('owner', this.vaultKey));
            const owners = this.ownerIds(existing);
            const uncertain = owners.filter(id => id !== ownerId && !liveOwners.includes(id));
            const unverified = uncertain.length > 0;
            // Quarantine the uncertain owner, not the whole vault: fresh runs and
            // history from a clean owner must remain usable after a crash.
            for (const id of uncertain) this.putControl(tx, key('uncertain-owner', this.vaultKey, id), true);
            this.putControl(tx, key('owner', this.vaultKey), JSON.stringify([...new Set([...owners.filter(id => liveOwners.includes(id)), ownerId])]));
            if (unverified) {
                const rows = await request(tx.objectStore('runs').index('vault').getAll(this.vaultKey)) as RunRow[];
                for (const row of rows) if (row.value.status === 'running'
                    && (!row.value.ownerSessionId || uncertain.includes(row.value.ownerSessionId))) {
                    row.value.status = row.value.collection === 'stopped' ? 'unknown' : 'interrupted';
                    row.value.endedAt = row.value.updatedAt;
                    row.value.expiresAt = row.value.updatedAt + this.budgets.retentionMs;
                    row.expiresAt = row.value.expiresAt; row.value.hasGap = true;
                    tx.objectStore('runs').put(row);
                }
            }
            return unverified;
        });
    }

    endOwner(ownerId: string): Promise<void> {
        return this.transact(['control'], 'readwrite', async tx => {
            const owners = this.ownerIds(await this.control(tx, key('owner', this.vaultKey))).filter(id => id !== ownerId);
            if (owners.length) this.putControl(tx, key('owner', this.vaultKey), JSON.stringify(owners));
            else tx.objectStore('control').delete(key('owner', this.vaultKey));
        });
    }

    private async isContentAllowed(tx: IDBTransaction, content: DebugContent, generation: DebugGeneration, ownerSessionId?: string): Promise<boolean> {
        if (generation.quarantined || content.generation !== generation.generation) return false;
        if (ownerSessionId && await this.control(tx, key('uncertain-owner', this.vaultKey, ownerSessionId))
            && (content.lineage.possibleDomains.includes('vault_notes') || content.lineage.completeness === 'unknown')) return false;
        for (const domain of content.lineage.possibleDomains) {
            if ((content.domainGenerations[domain] ?? 0) !== (generation.domains[domain] ?? 0)) return false;
        }
        for (const claimId of content.lineage.claimIds) {
            if (await this.control(tx, key('claim', '*', claimId)) || await this.control(tx, key('claim', content.vaultKey, claimId))) return false;
        }
        for (const legacyId of content.lineage.legacyRecordIds) {
            if (await this.control(tx, key('legacy', content.vaultKey, legacyId))) return false;
        }
        return true;
    }

    async writeBatch(batch: DebugBatch): Promise<boolean> {
        if (batch.run.vaultKey !== this.vaultKey || batch.events.some(event => event.vaultKey !== this.vaultKey)
            || batch.contents.some(content => content.vaultKey !== this.vaultKey)) throw new Error('Debug scope mismatch');
        return this.transact([...STORES], 'readwrite', async tx => {
            const generation = await this.generation(tx);
            if (batch.run.startedAt < this.now() - this.budgets.retentionMs) return false;
            if (generation.generation !== batch.generation.generation) return false;
            if (!await this.runAllowed(tx, batch.run)) return false;
            const runKey = key(this.vaultKey, batch.run.captureId);
            const incomingBytes = batch.contents.reduce((sum, content) => sum + rowBytes(content), 0)
                + batch.events.reduce((sum, event) => sum + rowBytes(event), 0) + rowBytes(batch.run);
            await this.pruneInTransaction(tx, incomingBytes, runKey);
            const old = await request(tx.objectStore('runs').get(runKey)) as RunRow | undefined;
            const partitionRows = await request(tx.objectStore('runs').index('vault').getAll(this.vaultKey)) as RunRow[];
            let partitionBytes = partitionRows.reduce((total, row) => total + row.bytes + row.value.accountedBytes, 0)
                + Number(await this.control(tx, key('control-bytes')) ?? 0) + (old ? 0 : rowBytes(batch.run));
            let bytes = old?.value.accountedBytes ?? 0;
            let eventCount = old?.value.eventCount ?? 0;
            let hasGap = old?.value.hasGap ?? batch.run.hasGap;
            const accepted = new Set<string>();
            for (const content of batch.contents) {
                if (!await this.isContentAllowed(tx, content, generation, batch.run.ownerSessionId)) { hasGap = true; continue; }
                const id = key(runKey, content.contentId);
                const previous = await request(tx.objectStore('contents').get(id)) as ContentRow | undefined;
                if (previous && (previous.value.text !== content.text || JSON.stringify(previous.value.lineage) !== JSON.stringify(content.lineage))) {
                    hasGap = true; continue; // Never turn a hash collision into incorrect historical input.
                }
                const nextBytes = rowBytes(content);
                if (utf8Bytes(content.text) > this.budgets.contentBytes || bytes + nextBytes - (previous?.bytes ?? 0) > this.budgets.runBytes
                    || partitionBytes + nextBytes - (previous?.bytes ?? 0) > this.budgets.persistentBytes) { hasGap = true; continue; }
                const row: ContentRow = { id, vaultKey: this.vaultKey, runKey, value: content, bytes: nextBytes,
                    claims: content.lineage.claimIds,
                    legacy: content.lineage.legacyRecordIds.map(value => key(this.vaultKey, value)),
                    domains: content.lineage.possibleDomains.map(value => key(this.vaultKey, value)),
                    unknownDomains: content.lineage.completeness === 'unknown' ? content.lineage.possibleDomains : [] };
                tx.objectStore('contents').put(row); bytes += nextBytes - (previous?.bytes ?? 0);
                partitionBytes += nextBytes - (previous?.bytes ?? 0); accepted.add(content.contentId);
            }
            let lastSeq = old?.value.lastCommittedSeq ?? 0;
            for (const event of batch.events) {
                if (eventCount >= this.budgets.runEvents || bytes > this.budgets.runBytes) { hasGap = true; continue; }
                const id = key(runKey, event.segment, event.seq);
                const previous = await request(tx.objectStore('events').get(id)) as Row<DebugEvent> | undefined;
                const safeEvent: DebugEvent = { ...event, contentIds: event.contentIds.filter(contentId => accepted.has(contentId)) };
                if (safeEvent.contentIds.length < event.contentIds.length) safeEvent.availability = 'cleared';
                const nextBytes = rowBytes(safeEvent);
                if (partitionBytes + nextBytes - (previous?.bytes ?? 0) > this.budgets.persistentBytes) { hasGap = true; continue; }
                tx.objectStore('events').put({ id, vaultKey: this.vaultKey, runKey, value: safeEvent, bytes: nextBytes });
                bytes += nextBytes - (previous?.bytes ?? 0); partitionBytes += nextBytes - (previous?.bytes ?? 0); if (!previous) eventCount++;
                lastSeq = Math.max(lastSeq, event.seq);
            }
            const run: DebugRun = { ...batch.run, accountedBytes: bytes, eventCount, lastCommittedSeq: lastSeq,
                hasGap, collection: hasGap && batch.run.collection === 'complete' ? 'partial' : batch.run.collection };
            const row: RunRow = { id: runKey, vaultKey: this.vaultKey, runKey, value: run, bytes: rowBytes(run),
                startedAt: run.startedAt, expiresAt: run.expiresAt };
            tx.objectStore('runs').put(row);
            await this.pruneInTransaction(tx);
            return true;
        });
    }

    async listRuns(query: DebugRunQuery = {}): Promise<DebugRun[]> {
        return this.transact(['runs', 'control'], 'readonly', async tx => {
            const result: DebugRun[] = [];
            const range = this.ranges!.bound([this.vaultKey, 0, ''], [this.vaultKey, query.before ?? Number.MAX_SAFE_INTEGER, '\uffff']);
            const cursor = tx.objectStore('runs').index('started').openCursor(range, 'prev');
            await new Promise<void>((resolve, reject) => {
                cursor.onerror = () => reject(cursor.error);
                cursor.onsuccess = () => {
                    const entry = cursor.result;
                    if (!entry || result.length >= Math.min(100, Math.max(1, query.limit ?? 50))) { resolve(); return; }
                    const run = (entry.value as RunRow).value;
                    if (run.expiresAt > this.now() && (query.before === undefined || run.startedAt < query.before)
                        && (!query.conversationId || run.conversationId === query.conversationId)
                        && (!query.status || run.status === query.status)) result.push(run);
                    entry.continue();
                };
            });
            return result;
        });
    }

    getRun(captureId: string): Promise<DebugRun | undefined> {
        return this.transact(['runs'], 'readonly', async tx => {
            const row = await request(tx.objectStore('runs').get(key(this.vaultKey, captureId))) as RunRow | undefined;
            return row && row.value.expiresAt > this.now() ? row.value : undefined;
        });
    }

    async getEvents(captureId: string, query: DebugEventQuery = {}): Promise<DebugEvent[]> {
        return this.transact(['runs', 'events', 'contents', 'control'], 'readonly', async tx => {
            const runKey = key(this.vaultKey, captureId);
            const run = await request(tx.objectStore('runs').get(runKey)) as RunRow | undefined;
            if (!run || run.expiresAt <= this.now()) return [];
            const range = this.ranges!.bound([runKey, (query.after ?? -1) + 1], [runKey, Number.MAX_SAFE_INTEGER]);
            const rows = await request(tx.objectStore('events').index('sequence').getAll(range, Math.min(500, query.limit ?? 200))) as Row<DebugEvent>[];
            const uncertain = run.value.ownerSessionId
                && await this.control(tx, key('uncertain-owner', this.vaultKey, run.value.ownerSessionId));
            if (!uncertain) return rows.map(row => row.value);
            const contents = await request(tx.objectStore('contents').index('run').getAll(runKey)) as ContentRow[];
            const hidden = new Set(contents.filter(row => row.value.lineage.possibleDomains.includes('vault_notes')
                || row.value.lineage.completeness === 'unknown').map(row => row.value.contentId));
            return rows.map(row => row.value.contentIds.some(id => hidden.has(id))
                ? { ...row.value, label: undefined, details: undefined, contentIds: [], availability: 'recovery_unverified' }
                : row.value);
        });
    }

    async getContents(captureId: string, nodeId?: string): Promise<DebugContent[]> {
        return this.transact(['runs', 'events', 'contents', 'control'], 'readonly', async tx => {
            const runKey = key(this.vaultKey, captureId);
            const run = await request(tx.objectStore('runs').get(runKey)) as RunRow | undefined;
            if (!run || run.expiresAt <= this.now()) return [];
            const generation = await this.generation(tx);
            if (generation.quarantined) return [];
            let selected: string[] | undefined;
            if (nodeId) {
                const events = await request(tx.objectStore('events').index('run').getAll(runKey)) as Row<DebugEvent>[];
                selected = events.filter(row => row.value.nodeId === nodeId).sort((left, right) => left.value.seq - right.value.seq)
                    .flatMap(row => row.value.contentIds);
            }
            const rows = await request(tx.objectStore('contents').index('run').getAll(runKey)) as ContentRow[];
            const result: DebugContent[] = [];
            for (const row of rows) if ((!selected || selected.includes(row.value.contentId))
                && await this.isContentAllowed(tx, row.value, generation, run.value.ownerSessionId)) result.push(row.value);
            if (!selected) return result;
            const byId = new Map(result.map(content => [content.contentId, content]));
            return selected.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
        });
    }

    private async removeRun(tx: IDBTransaction, row: RunRow): Promise<void> {
        for (const name of ['events', 'contents'] as const) {
            const ids = await request(tx.objectStore(name).index('run').getAllKeys(row.runKey));
            for (const id of ids) tx.objectStore(name).delete(id);
        }
        tx.objectStore('runs').delete(row.id);
    }

    private async pruneInTransaction(tx: IDBTransaction, reserveBytes = 0, protectedRunKey?: string): Promise<void> {
        const controls = await request(tx.objectStore('control').index('expires').getAllKeys(this.ranges!.upperBound(this.now()), 20));
        for (const id of controls) tx.objectStore('control').delete(id);
        if (controls.length) this.dirtyControl.add(tx);
        const expired = await request(tx.objectStore('runs').index('expires').getAll(this.ranges!.upperBound(this.now()), 20)) as RunRow[];
        for (const row of expired) await this.removeRun(tx, row);
        const rows = await request(tx.objectStore('runs').index('vault').getAll(this.vaultKey)) as RunRow[];
        let bytes = rows.reduce((sum, row) => sum + row.bytes + row.value.accountedBytes, 0)
            + Number(await this.control(tx, key('control-bytes')) ?? 0);
        const candidates = rows.filter(row => row.value.endedAt !== undefined && row.runKey !== protectedRunKey).sort((left, right) => left.value.endedAt! - right.value.endedAt!);
        for (const row of candidates.slice(0, 20)) {
            if (bytes + reserveBytes <= this.budgets.persistentBytes) break;
            await this.removeRun(tx, row); bytes -= row.bytes + row.value.accountedBytes;
        }
    }
    prune(): Promise<void> { return this.transact([...STORES], 'readwrite', tx => this.pruneInTransaction(tx)); }

    async invalidateConversation(conversationId: string, options: { runIds?: string[]; operationId?: string; before?: number; permanent?: boolean } = {}): Promise<void> {
        return this.transact([...STORES], 'readwrite', async tx => {
            if (options.operationId && await this.control(tx, key('applied', this.vaultKey, options.operationId))) return;
            const revision = key('revision', this.vaultKey);
            this.putControl(tx, revision, Number(await this.control(tx, revision) ?? 0) + 1);
            if (options.permanent) this.putControl(tx, key('conversation', this.vaultKey, conversationId), true);
            else if (!options.runIds?.length) {
                const cutoffKey = key('conversation-cutoff', this.vaultKey, conversationId);
                this.putControl(tx, cutoffKey, Math.max(Number(await this.control(tx, cutoffKey) ?? 0), options.before ?? this.now()));
            }
            for (const runId of options.runIds ?? []) this.putControl(tx, key('run', this.vaultKey, runId), true);
            const rows = await request(tx.objectStore('runs').index('vault').getAll(this.vaultKey)) as RunRow[];
            for (const row of rows) if (row.value.conversationId === conversationId
                && (options.runIds?.length ? options.runIds.includes(row.value.runtimeRunId ?? '') || options.runIds.includes(row.value.captureId)
                    : options.permanent || row.value.startedAt <= (options.before ?? this.now()))) await this.removeRun(tx, row);
            if (options.operationId) this.putControl(tx, key('applied', this.vaultKey, options.operationId), true);
        });
    }

    async clear(): Promise<void> {
        return this.transact([...STORES], 'readwrite', async tx => {
            const generation = await this.generation(tx);
            this.putControl(tx, key('generation', this.vaultKey), generation.generation + 1);
            this.putControl(tx, key('quarantine', this.vaultKey), false);
            const rows = await request(tx.objectStore('runs').index('vault').getAll(this.vaultKey)) as RunRow[];
            for (const row of rows) await this.removeRun(tx, row);
        });
    }

    private async redactContentRows(tx: IDBTransaction, rows: ContentRow[]): Promise<void> {
        const touched = new Set<string>();
        for (const row of rows) { tx.objectStore('contents').delete(row.id); touched.add(row.runKey); }
        for (const runKey of touched) {
            const runRow = await request(tx.objectStore('runs').get(runKey)) as RunRow | undefined;
            if (!runRow) continue;
            const events = await request(tx.objectStore('events').index('run').getAll(runKey)) as Row<DebugEvent>[];
            for (const event of events) {
                // Mixed diagnostics can repeat a title/path: retain only structure after a content revocation.
                event.value = { ...event.value, label: undefined, details: undefined, contentIds: [], availability: 'cleared' };
                event.bytes = rowBytes(event.value); tx.objectStore('events').put(event);
            }
            const remaining = await request(tx.objectStore('contents').index('run').getAll(runKey)) as ContentRow[];
            runRow.value.hasGap = true;
            runRow.value.accountedBytes = [...events, ...remaining].reduce((sum, row) => sum + row.bytes, 0);
            tx.objectStore('runs').put(runRow);
        }
    }

    async revokeDomains(domains: readonly DebugDomain[], options: { sourceToken?: string } = {}): Promise<void> {
        return this.transact([...STORES], 'readwrite', async tx => {
            const rows = new Map<string, ContentRow>();
            for (const domain of domains) {
                const id = key('domain', this.vaultKey, domain);
                this.putControl(tx, id, Number(await this.control(tx, id) ?? 0) + 1);
                const entries = await request(tx.objectStore('contents').index('domains').getAll(key(this.vaultKey, domain))) as ContentRow[];
                entries.forEach(row => rows.set(row.id, row));
            }
            await this.redactContentRows(tx, [...rows.values()]);
            if (options.sourceToken !== undefined) this.putControl(tx, key('source-token', this.vaultKey), options.sourceToken);
        });
    }

    async forgetClaim(claimId: string, options: { deviceWide?: boolean; domains?: readonly DebugDomain[] } = {}): Promise<void> {
        return this.transact([...STORES], 'readwrite', async tx => {
            const tombstone = key('claim', options.deviceWide ? '*' : this.vaultKey, claimId);
            if (await this.control(tx, tombstone)) return;
            this.putControl(tx, tombstone, true);
            const exact = await request(tx.objectStore('contents').index('claims').getAll(claimId)) as ContentRow[];
            const rows = new Map(exact.filter(row => options.deviceWide || row.vaultKey === this.vaultKey).map(row => [row.id, row]));
            for (const domain of options.domains ?? ['personal_memory', 'insights']) {
                const id = key('domain', options.deviceWide ? '*' : this.vaultKey, domain);
                this.putControl(tx, id, Number(await this.control(tx, id) ?? 0) + 1);
                const unknown = await request(tx.objectStore('contents').index('unknownDomains').getAll(domain)) as ContentRow[];
                for (const row of unknown) if (options.deviceWide || row.vaultKey === this.vaultKey) rows.set(row.id, row);
            }
            await this.redactContentRows(tx, [...rows.values()]);
        });
    }

    async forgetLegacyRecord(recordId: string): Promise<void> {
        await this.transact([...STORES], 'readwrite', async tx => {
            const tombstone = key('legacy', this.vaultKey, recordId);
            if (await this.control(tx, tombstone)) return;
            this.putControl(tx, tombstone, true);
            const rows = await request(tx.objectStore('contents').index('legacy').getAll(key(this.vaultKey, recordId))) as ContentRow[];
            const id = key('domain', this.vaultKey, 'legacy_memory');
            this.putControl(tx, id, Number(await this.control(tx, id) ?? 0) + 1);
            const unknown = await request(tx.objectStore('contents').index('unknownDomains').getAll('legacy_memory')) as ContentRow[];
            await this.redactContentRows(tx, [...new Map([...rows, ...unknown.filter(row => row.vaultKey === this.vaultKey)].map(row => [row.id, row])).values()]);
        });
    }

    async applySourceToken(token: string): Promise<void> {
        const current = await this.getGeneration();
        if (current.sourceToken !== token) await this.revokeDomains(DEBUG_DOMAINS, { sourceToken: token });
    }

    setQuarantined(value: boolean): Promise<void> {
        return this.transact(['control'], 'readwrite', async tx => { this.putControl(tx, key('quarantine', this.vaultKey), value); });
    }

    async status(): Promise<DebugStoreStatus> {
        return this.transact(['runs', 'control'], 'readonly', async tx => {
            const rows = await request(tx.objectStore('runs').index('vault').getAll(this.vaultKey)) as RunRow[];
            const generation = await this.generation(tx);
            return { available: true, recoveryReady: !generation.quarantined,
                bytes: rows.reduce((sum, row) => sum + row.bytes + row.value.accountedBytes, 0)
                    + Number(await this.control(tx, key('control-bytes')) ?? 0), limit: this.budgets.persistentBytes };
        });
    }

    close(): void { this.closed = true; this.database?.close(); this.database = undefined; }
}
