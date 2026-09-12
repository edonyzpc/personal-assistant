import { describe, expect, it, jest } from '@jest/globals';
import { Document } from '@langchain/core/documents';
import type { App, TFile } from 'obsidian';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import { createTaskSourceMemoryHost } from '../src/ai-services/task-source-memory-host';
import type { TaskSourceReadGuard } from '../src/ai-services/task-source-read-guard';
import { buildGraphBoundarySnapshot, type GraphBoundarySnapshotSource, type ResolvedLinksInput } from '../src/graph/graph-boundary-snapshot';
import type { MemorySearchPort } from '../src/memory/MemorySearchPort';
import { createAiServiceHost } from '../src/tests/factories/host-factory';
import type { NoteSearchScope, RankedPathRequestControl } from '../src/vss/types';

const A = 'notes/a.md';
const B = 'notes/b.md';
const EXCLUDED = 'notes/excluded.md';
const OPAQUE = 'notes/opaque.md';
const scope: NoteSearchScope = { allowedPaths: [A, B, EXCLUDED, OPAQUE], excludedPaths: [EXCLUDED] };
const rankControl: RankedPathRequestControl = {
    requestId: 'rank-1', runEpoch: 'run-1', sourceEpoch: 'source-1', absoluteDeadlineMs: 10_000,
    maxPathsPerBatch: 10, maxCandidatePaths: 20, maxChunksScanned: 100,
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function document(path: string) {
    return { score: 0.9, doc: new Document({ pageContent: `Content from ${path}`, metadata: { path } }) };
}

function harness(noteScope = scope) {
    let current = true;
    let delay: Promise<void> | undefined;
    const blocked = new Set<string>();
    const boundaryBlocked = new Set<string>();
    const wait = async () => { await delay; };
    const guard: TaskSourceReadGuard = {
        isCurrent: jest.fn(() => current),
        isPathAllowed: jest.fn((path: string) => !blocked.has(path) && [A, B, EXCLUDED, OPAQUE].includes(path)),
    };
    const ensureReadyForChat = jest.fn<MemorySearchPort['ensureReadyForChat']>().mockImplementation(async () => {
        await wait();
        return { decision: 'use-memory' };
    });
    const searchHybrid = jest.fn<MemorySearchPort['searchHybrid']>().mockImplementation(async () => {
        await wait();
        return [document(A)];
    });
    const getChunksByPath = jest.fn<MemorySearchPort['getChunksByPath']>().mockImplementation(async paths => {
        await wait();
        return paths.map(document);
    });
    const getPathEvidenceGenerations = jest.fn<MemorySearchPort['getPathEvidenceGenerations']>().mockImplementation(async paths => {
        await wait();
        return { sourceEpoch: 'source-1', paths: paths.map(path => ({ path, current: true, reason: 'current', generation: 'generation-1' })) };
    });
    const rankGraphCandidates = jest.fn<MemorySearchPort['rankGraphCandidates']>().mockImplementation(async (_embedding, paths, control) => {
        await wait();
        return { requestId: control.requestId, runEpoch: control.runEpoch, sourceEpoch: control.sourceEpoch,
            paths: paths.map(path => ({ path, pathEvidenceGeneration: 'generation-1', maxScore: 0.9,
                chunks: [{ ...document(path), chunkIndex: 0 }] })) };
    });
    const readLatestMemorySource = jest.fn<NonNullable<AiServiceHost['readLatestMemorySource']>>().mockImplementation(async path => {
        await wait();
        return { path, markdown: `Latest ${path}`, mtime: 10, size: 30 };
    });
    const getMemoryEvidenceEpoch = jest.fn(() => 'boundary-1');
    const getGraphBoundarySnapshotSource = jest.fn<NonNullable<AiServiceHost['getGraphBoundarySnapshotSource']>>(() => undefined);
    const cancelGraphCandidateRank = jest.fn<MemorySearchPort['cancelGraphCandidateRank']>();
    const isDataBoundaryAllowedPath = jest.fn((path: string) => !boundaryBlocked.has(path));
    const getMarkdownFiles = jest.fn(() => [A, B, EXCLUDED, OPAQUE].map(path => ({ path }) as TFile));
    const host = createAiServiceHost({
        app: { vault: { getMarkdownFiles } } as unknown as App,
        memorySearch: { ensureReadyForChat, searchHybrid, getChunksByPath, getPathEvidenceGenerations, rankGraphCandidates, cancelGraphCandidateRank },
        readLatestMemorySource, getMemoryEvidenceEpoch, getGraphBoundarySnapshotSource, isDataBoundaryAllowedPath,
    });
    const scoped = createTaskSourceMemoryHost(host, guard, noteScope);
    const operations = {
        ready: () => scoped.memorySearch.ensureReadyForChat('query'),
        search: () => scoped.memorySearch.searchHybrid('query'),
        chunks: () => scoped.memorySearch.getChunksByPath([A]),
        evidence: () => scoped.memorySearch.getPathEvidenceGenerations([A]),
        rank: () => scoped.memorySearch.rankGraphCandidates([1, 0], [A], rankControl),
        latest: () => scoped.readLatestMemorySource!(A),
    };
    return { host, scoped, guard, blocked, boundaryBlocked, operations,
        ensureReadyForChat, searchHybrid, getChunksByPath, getPathEvidenceGenerations, rankGraphCandidates,
        readLatestMemorySource, getMemoryEvidenceEpoch, getGraphBoundarySnapshotSource, cancelGraphCandidateRank,
        getMarkdownFiles,
        setCurrent: (value: boolean) => { current = value; },
        setDelay: (value: Promise<void>) => { delay = value; },
    };
}

describe('per-invocation task source Memory host', () => {
    it('overrides a supplied search scope before dispatch and preserves other request options', async () => {
        const fixture = harness();
        const signal = new AbortController().signal;
        await fixture.scoped.memorySearch.searchHybrid('query', {
            signal, retrievalMode: 'relaxed', absoluteDeadlineMs: 123,
            noteScope: { allowedPaths: null, excludedPaths: [] },
        });
        expect(fixture.searchHybrid).toHaveBeenCalledWith('query', {
            signal, retrievalMode: 'relaxed', absoluteDeadlineMs: 123,
            noteScope: { allowedPaths: [A, B, OPAQUE], excludedPaths: [EXCLUDED] },
        });
        expect(fixture.searchHybrid.mock.contexts[0]).toBe(fixture.host.memorySearch);
    });

    it.each([
        { allowedPaths: [A], excludedPaths: [] },
        { allowedPaths: null, excludedPaths: [EXCLUDED] },
    ])('uses existing Memory only for a restricted search scope %j', async noteScope => {
        const fixture = harness(noteScope);
        const signal = new AbortController().signal;
        const owner = new AbortController().signal;
        await fixture.scoped.memorySearch.ensureReadyForChat('query', signal, owner);
        expect(fixture.ensureReadyForChat).toHaveBeenCalledWith('query', signal, owner, { existingOnly: true });
    });

    it('retains ordinary Memory readiness behavior for the complete vault', async () => {
        const fixture = harness({ allowedPaths: null, excludedPaths: [] });
        await fixture.scoped.memorySearch.ensureReadyForChat('query');
        expect(fixture.ensureReadyForChat).toHaveBeenCalledWith('query', undefined, undefined, undefined);
    });

    it('preserves an explicit existing-only request even for the complete vault', async () => {
        const fixture = harness({ allowedPaths: null, excludedPaths: [] });
        await fixture.scoped.memorySearch.ensureReadyForChat('query', undefined, undefined, { existingOnly: true });
        expect(fixture.ensureReadyForChat).toHaveBeenCalledWith('query', undefined, undefined, { existingOnly: true });
    });

    it('intersects a vault-wide search before cached content is read, using only enumerated paths', async () => {
        const fixture = harness({ allowedPaths: null, excludedPaths: [EXCLUDED] });
        fixture.boundaryBlocked.add(B);
        fixture.blocked.add(OPAQUE);
        const forbiddenMetadata = jest.fn(() => { throw new Error('Non-path metadata was read'); });
        fixture.getMarkdownFiles.mockReturnValue([A, B, EXCLUDED, OPAQUE, 'new.md'].map(path => Object.defineProperties({ path }, {
            stat: { get: forbiddenMetadata }, basename: { get: forbiddenMetadata }, name: { get: forbiddenMetadata },
        }) as TFile));
        await expect(fixture.operations.search()).resolves.toEqual([document(A)]);
        expect(fixture.searchHybrid).toHaveBeenCalledWith('query', {
            noteScope: { allowedPaths: [A], excludedPaths: [EXCLUDED] },
        });
        expect(forbiddenMetadata).not.toHaveBeenCalled();
        expect(fixture.getMarkdownFiles).toHaveBeenCalledTimes(1);
    });

    it('rejects an unenumerated result even when the live path guard would allow it', async () => {
        const fixture = harness({ allowedPaths: null, excludedPaths: [] });
        fixture.getMarkdownFiles.mockReturnValue([{ path: A } as TFile]);
        fixture.searchHybrid.mockResolvedValueOnce([document(B)]);
        await expect(fixture.operations.search()).rejects.toThrow('outside');
        expect(fixture.searchHybrid).toHaveBeenCalledWith('query', {
            noteScope: { allowedPaths: [A], excludedPaths: [] },
        });
    });

    it.each(['ready', 'search', 'chunks', 'evidence', 'rank', 'latest'] as const)(
        'rejects %s before the first underlying read when the guard is stale', async operation => {
            const fixture = harness();
            fixture.setCurrent(false);
            await expect(fixture.operations[operation]()).rejects.toThrow('no longer current');
            for (const method of [fixture.ensureReadyForChat, fixture.searchHybrid, fixture.getChunksByPath,
                fixture.getPathEvidenceGenerations, fixture.rankGraphCandidates, fixture.readLatestMemorySource]) {
                expect(method).not.toHaveBeenCalled();
            }
            expect(() => fixture.scoped.getMemoryEvidenceEpoch!()).toThrow('no longer current');
            expect(() => fixture.scoped.getGraphBoundarySnapshotSource!()).toThrow('no longer current');
            expect(fixture.getMemoryEvidenceEpoch).not.toHaveBeenCalled();
            expect(fixture.getGraphBoundarySnapshotSource).not.toHaveBeenCalled();
        },
    );

    it.each(['chunks', 'evidence', 'rank'] as const)('rejects the entire %s path batch before any partial read', async operation => {
        const fixture = harness();
        const paths = [A, EXCLUDED];
        const request = operation === 'chunks' ? fixture.scoped.memorySearch.getChunksByPath(paths)
            : operation === 'evidence' ? fixture.scoped.memorySearch.getPathEvidenceGenerations(paths)
                : fixture.scoped.memorySearch.rankGraphCandidates([1], paths, rankControl);
        await expect(request).rejects.toThrow('outside the admitted note scope');
        expect(fixture.getChunksByPath).not.toHaveBeenCalled();
        expect(fixture.getPathEvidenceGenerations).not.toHaveBeenCalled();
        expect(fixture.rankGraphCandidates).not.toHaveBeenCalled();
    });

    it('keeps both the frozen scope and the original live Data Boundary in path admission', async () => {
        const fixture = harness();
        fixture.boundaryBlocked.add(A);
        fixture.blocked.add(B);
        expect(fixture.scoped.isDataBoundaryAllowedPath!(A)).toBe(false);
        expect(fixture.scoped.isDataBoundaryAllowedPath!(B)).toBe(false);
        expect(fixture.scoped.isDataBoundaryAllowedPath!(EXCLUDED)).toBe(false);
        expect(fixture.scoped.isDataBoundaryAllowedPath!('new.md')).toBe(false);
        expect(fixture.scoped.isDataBoundaryAllowedPath!(OPAQUE)).toBe(true);
        await expect(fixture.scoped.readLatestMemorySource!(A)).rejects.toThrow('outside');
        await expect(fixture.scoped.memorySearch.searchHybrid('query')).rejects.toThrow('outside');
        expect(fixture.readLatestMemorySource).not.toHaveBeenCalled();
        expect(fixture.searchHybrid).not.toHaveBeenCalled();
    });

    it.each(['ready', 'search', 'chunks', 'evidence', 'rank', 'latest'] as const)(
        'discards %s results when the invocation is revoked while awaiting the host', async operation => {
            const fixture = harness();
            const pending = deferred<void>();
            fixture.setDelay(pending.promise);
            const request = fixture.operations[operation]();
            const rejected = expect(request).rejects.toThrow('no longer current');
            fixture.setCurrent(false);
            pending.resolve();
            await rejected;
        },
    );

    it('rechecks every requested path after an asynchronous boundary change', async () => {
        const fixture = harness();
        const pending = deferred<void>();
        fixture.setDelay(pending.promise);
        const request = fixture.scoped.memorySearch.getChunksByPath([A, B]);
        const rejected = expect(request).rejects.toThrow('outside');
        fixture.boundaryBlocked.add(B);
        pending.resolve();
        await rejected;
        expect(fixture.getChunksByPath).toHaveBeenCalledTimes(1);
    });

    it('rejects new, excluded, or unrequested result paths without returning a filtered prefix', async () => {
        const fixture = harness();
        fixture.searchHybrid.mockResolvedValueOnce([document(A), document(EXCLUDED)]);
        await expect(fixture.operations.search()).rejects.toThrow('outside');
        fixture.searchHybrid.mockResolvedValueOnce([document('new.md')]);
        await expect(fixture.operations.search()).rejects.toThrow('outside');
        fixture.getChunksByPath.mockResolvedValueOnce([document(A), document(B)]);
        await expect(fixture.operations.chunks()).rejects.toThrow('outside');
        fixture.getPathEvidenceGenerations.mockResolvedValueOnce({ sourceEpoch: 'epoch', paths: [{ path: B, current: false, reason: 'missing' }] });
        await expect(fixture.operations.evidence()).rejects.toThrow('outside');
        fixture.rankGraphCandidates.mockResolvedValueOnce({ ...rankControl, paths: [{ path: A, pathEvidenceGeneration: 'g', maxScore: 1,
            chunks: [{ ...document(B), chunkIndex: 0 }] }] });
        await expect(fixture.operations.rank()).rejects.toThrow('outside');
        fixture.readLatestMemorySource.mockResolvedValueOnce({ path: B, markdown: 'wrong source', mtime: 1, size: 1 });
        await expect(fixture.operations.latest()).rejects.toThrow('outside');
    });

    it('keeps sibling invocation scopes, snapshots and late completions independent', async () => {
        const fixture = harness();
        const mutableScope: NoteSearchScope = { allowedPaths: [A], excludedPaths: [] };
        const scopedA = createTaskSourceMemoryHost(fixture.host, fixture.guard, mutableScope);
        const scopedB = createTaskSourceMemoryHost(fixture.host, { isCurrent: () => true, isPathAllowed: path => path === B },
            { allowedPaths: [B], excludedPaths: [] });
        mutableScope.allowedPaths = [B];
        const pending = deferred<ReturnType<typeof document>[]>();
        fixture.searchHybrid.mockImplementationOnce(() => pending.promise).mockResolvedValueOnce([document(B)]);
        const requestA = scopedA.memorySearch.searchHybrid('A');
        const rejectedA = expect(requestA).rejects.toThrow('no longer current');
        await expect(scopedB.memorySearch.searchHybrid('B')).resolves.toEqual([document(B)]);
        fixture.setCurrent(false);
        pending.resolve([document(A)]);
        await rejectedA;
        expect(fixture.searchHybrid.mock.calls.map(([, options]) => options?.noteScope)).toEqual([
            { allowedPaths: [A], excludedPaths: [] }, { allowedPaths: [B], excludedPaths: [] },
        ]);
        await expect(scopedB.memorySearch.getChunksByPath([A])).rejects.toThrow('outside');
    });

    it('retains live getters, original method receivers, Personal and cancellation even on a frozen host', () => {
        const fixture = harness();
        let settings = fixture.host.settings;
        Object.defineProperty(fixture.host, 'settings', { configurable: true, get: () => settings });
        const personal = jest.fn(function (this: AiServiceHost) { return { model: this.settings.chatModelName }; });
        fixture.host.getMemoryExtractionPromptContext = personal;
        Object.freeze(fixture.host);
        const scoped = createTaskSourceMemoryHost(fixture.host, fixture.guard, scope);
        const readPersonal = scoped.getMemoryExtractionPromptContext;
        settings = { ...settings, chatModelName: 'changed-live' };
        fixture.setCurrent(false);
        expect(scoped.settings).toBe(settings);
        expect(readPersonal()).toEqual({ model: 'changed-live' });
        expect(personal.mock.contexts[0]).toBe(fixture.host);
        scoped.memorySearch.cancelGraphCandidateRank('request', 'run');
        expect(fixture.cancelGraphCandidateRank).toHaveBeenCalledWith('request', 'run');
    });

    it('does not invent optional source capabilities absent from the original host', () => {
        const fixture = harness();
        delete fixture.host.readLatestMemorySource;
        delete fixture.host.getGraphBoundarySnapshotSource;
        delete fixture.host.getMemoryEvidenceEpoch;
        expect(fixture.scoped.readLatestMemorySource).toBeUndefined();
        expect(fixture.scoped.getGraphBoundarySnapshotSource).toBeUndefined();
        expect(fixture.scoped.getMemoryEvidenceEpoch).toBeUndefined();
    });
});

describe('task-scoped graph topology reads', () => {
    it.each(['record', 'map'] as const)('never gets excluded source rows or target values from %s topology', async kind => {
        const fixture = harness();
        const excludedRow = jest.fn(() => { throw new Error('Excluded source was read'); });
        const excludedWeight = jest.fn(() => { throw new Error('Excluded edge value was read'); });
        const targets: Record<string, number> = { [B]: 1, [OPAQUE]: 2 };
        Object.defineProperty(targets, EXCLUDED, { enumerable: true, get: excludedWeight });
        const allowedRow = jest.fn(() => targets);
        let links: ResolvedLinksInput;
        const readMapPaths: string[] = [];
        if (kind === 'record') {
            links = Object.defineProperties({}, {
                [A]: { enumerable: true, get: allowedRow },
                [EXCLUDED]: { enumerable: true, get: excludedRow },
            });
        } else {
            const map = new Map([[A, targets], [EXCLUDED, { [A]: 1 }]]);
            const originalGet = map.get.bind(map);
            jest.spyOn(map, 'get').mockImplementation(path => { readMapPaths.push(path); return originalGet(path); });
            links = map;
        }
        const source: GraphBoundarySnapshotSource = {
            resolvedLinks: links,
            getEpoch() { expect(this).toBe(source); return 'graph-1'; },
            canonicalizePath(path) { expect(this).toBe(source); return path.replace(/^\.\//, ''); },
            classifyPath(path) { expect(this).toBe(source); return path === OPAQUE ? 'opaque_excluded_markdown' : 'allowed_markdown'; },
        };
        fixture.boundaryBlocked.add(OPAQUE);
        fixture.getGraphBoundarySnapshotSource.mockReturnValue(source);
        const scopedSource = fixture.scoped.getGraphBoundarySnapshotSource!()!;
        expect(scopedSource.classifyPath(EXCLUDED)).toBe('blocked');
        expect(scopedSource.classifyPath(OPAQUE)).toBe('opaque_excluded_markdown');
        expect(scopedSource.canonicalizePath(`./${A}`)).toBe(A);
        expect(scopedSource.canonicalizePath(EXCLUDED)).toBeNull();
        expect(fixture.scoped.isDataBoundaryAllowedPath!(OPAQUE)).toBe(false);
        const result = await buildGraphBoundarySnapshot(scopedSource, {
            maxSnapshotNodes: 10, maxSnapshotEdges: 10, maxSnapshotBytes: 20_000, absoluteDeadlineMs: 1000,
        }, { now: () => 0 });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        expect([...result.snapshot.resolvedLinks].map(([path, targets]) => [path, [...targets]])).toEqual([[A, [B, OPAQUE]]]);
        expect(result.snapshot.pathClasses.has(EXCLUDED)).toBe(false);
        expect(excludedRow).not.toHaveBeenCalled();
        expect(excludedWeight).not.toHaveBeenCalled();
        if (kind === 'map') expect(readMapPaths).toEqual([A]);
        else expect(allowedRow).toHaveBeenCalledTimes(1);
    });

    it('checks the guard again when a previously acquired graph view reads a row', () => {
        const fixture = harness();
        const row = jest.fn(() => ({ [B]: 1 }));
        fixture.getGraphBoundarySnapshotSource.mockReturnValue({
            resolvedLinks: Object.defineProperty({}, A, { enumerable: true, get: row }),
            getEpoch: () => 'epoch', canonicalizePath: path => path, classifyPath: () => 'allowed_markdown',
        });
        const source = fixture.scoped.getGraphBoundarySnapshotSource!()!;
        const links = source.resolvedLinks as Readonly<Record<string, unknown>>;
        expect(Object.keys(links)).toEqual([A]);
        fixture.setCurrent(false);
        expect(() => links[A]).toThrow('no longer current');
        expect(() => source.getEpoch()).toThrow('no longer current');
        expect(row).not.toHaveBeenCalled();
    });

    it('rejects a graph row whose getter revokes the invocation before its value can escape', () => {
        const fixture = harness();
        fixture.getGraphBoundarySnapshotSource.mockReturnValue({
            resolvedLinks: Object.defineProperty({}, A, { enumerable: true, get: () => {
                fixture.setCurrent(false);
                return { [B]: 1 };
            } }),
            getEpoch: () => 'epoch', canonicalizePath: path => path, classifyPath: () => 'allowed_markdown',
        });
        const links = fixture.scoped.getGraphBoundarySnapshotSource!()!.resolvedLinks as Readonly<Record<string, unknown>>;
        expect(() => links[A]).toThrow('no longer current');
    });
});
