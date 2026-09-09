import type { GraphBoundarySnapshotSource, ResolvedLinksInput, ResolvedLinkTargets } from '../graph/graph-boundary-snapshot';
import type { MemorySearchPort } from '../memory/MemorySearchPort';
import { copyNoteSearchScope, type NoteSearchScope } from '../vss/types';
import type { AiServiceHost } from './AiServiceHost';
import { assertTaskSourceReadCurrent, isTaskSourcePathAllowed, type TaskSourceReadGuard } from './task-source-read-guard';

/** One invocation's note-reading boundary; Personal and other host capabilities stay live. */
export function createTaskSourceMemoryHost(
    host: AiServiceHost,
    guard: TaskSourceReadGuard,
    noteScope: NoteSearchScope,
): AiServiceHost {
    const copiedScope = copyNoteSearchScope(noteScope);
    if (!copiedScope) throw new Error('Task Memory search requires a note scope.');
    const scope: NoteSearchScope = Object.freeze({
        allowedPaths: copiedScope.allowedPaths === null ? null : Object.freeze([...copiedScope.allowedPaths]),
        excludedPaths: Object.freeze([...copiedScope.excludedPaths]),
    });
    const allowedPaths = scope.allowedPaths === null ? null : new Set(scope.allowedPaths);
    const excludedPaths = new Set(scope.excludedPaths);
    const restricted = allowedPaths !== null || excludedPaths.size > 0;
    const assertCurrent = (): void => assertTaskSourceReadCurrent(guard);
    const taskAllowsPath = (path: string): boolean => typeof path === 'string' && path.length > 0
        && (allowedPaths === null || allowedPaths.has(path)) && !excludedPaths.has(path)
        && isTaskSourcePathAllowed(guard, path);
    const allowsEvidencePath = (path: string): boolean => {
        if (!taskAllowsPath(path)) return false;
        try {
            return host.isDataBoundaryAllowedPath ? host.isDataBoundaryAllowedPath(path) === true : true;
        } catch { return false; }
    };
    const assertPaths = (paths: readonly string[], requested?: ReadonlySet<string>): void => {
        assertCurrent();
        if (paths.some(path => !allowsEvidencePath(path) || (requested !== undefined && !requested.has(path)))) {
            throw new Error('Task Memory source is outside the admitted note scope.');
        }
        assertCurrent();
    };
    const captureSearchPaths = (): string[] => {
        assertCurrent();
        if (scope.allowedPaths !== null) {
            const paths = scope.allowedPaths.filter(path => !excludedPaths.has(path));
            assertPaths(paths);
            return paths;
        }
        // Vault enumeration supplies identities only. SQL must receive the
        // admitted finite set before it reads or ranks cached note content.
        const files = host.app.vault.getMarkdownFiles();
        assertCurrent();
        const paths = files.map(file => file.path).filter(allowsEvidencePath);
        assertPaths(paths);
        return [...new Set(paths)];
    };
    const checkDocuments = (results: Awaited<ReturnType<MemorySearchPort['searchHybrid']>>, requested?: ReadonlySet<string>): void => {
        assertPaths(results.map(result => result.doc.metadata.path), requested);
    };

    const memorySearch: MemorySearchPort = {
        async ensureReadyForChat(query, signal, preparationOwnerSignal, options) {
            assertCurrent();
            const result = await host.memorySearch.ensureReadyForChat(query, signal, preparationOwnerSignal,
                restricted ? { ...options, existingOnly: true } : options);
            assertCurrent();
            return result;
        },
        async searchHybrid(query, options) {
            const paths = captureSearchPaths();
            const searchScope = Object.freeze({ allowedPaths: Object.freeze(paths), excludedPaths: scope.excludedPaths });
            const result = await host.memorySearch.searchHybrid(query, { ...options, noteScope: searchScope });
            assertPaths(paths);
            checkDocuments(result, new Set(paths));
            return result;
        },
        async getChunksByPath(paths, options) {
            const requestedPaths = [...paths];
            assertPaths(requestedPaths);
            const result = await host.memorySearch.getChunksByPath(requestedPaths, options);
            assertPaths(requestedPaths);
            checkDocuments(result, new Set(requestedPaths));
            return result;
        },
        async getPathEvidenceGenerations(paths, options) {
            const requestedPaths = [...paths];
            assertPaths(requestedPaths);
            const result = await host.memorySearch.getPathEvidenceGenerations(requestedPaths, options);
            assertPaths(requestedPaths);
            assertPaths(result.paths.map(entry => entry.path), new Set(requestedPaths));
            return result;
        },
        async rankGraphCandidates(queryEmbedding, paths, control, options) {
            const requestedPaths = [...paths];
            assertPaths(requestedPaths);
            const result = await host.memorySearch.rankGraphCandidates(queryEmbedding, requestedPaths, control, options);
            assertPaths(requestedPaths);
            assertPaths(result.paths.map(entry => entry.path), new Set(requestedPaths));
            for (const entry of result.paths) {
                assertPaths(entry.chunks.map(chunk => chunk.doc.metadata.path), new Set([entry.path]));
            }
            return result;
        },
        // Revocation must not prevent cleanup of a request already dispatched.
        cancelGraphCandidateRank(requestId, runEpoch) {
            host.memorySearch.cancelGraphCandidateRank(requestId, runEpoch);
        },
    };

    const overrides: Partial<AiServiceHost> = {
        memorySearch,
        isDataBoundaryAllowedPath: allowsEvidencePath,
        getMemoryEvidenceEpoch: () => {
            assertCurrent();
            const epoch = host.getMemoryEvidenceEpoch!();
            assertCurrent();
            return epoch;
        },
        readLatestMemorySource: async (path, signal) => {
            assertPaths([path]);
            const result = await host.readLatestMemorySource!(path, signal);
            assertPaths([path]);
            if (result) assertPaths([result.path], new Set([path]));
            return result;
        },
        getGraphBoundarySnapshotSource: () => {
            assertCurrent();
            const source = host.getGraphBoundarySnapshotSource!();
            assertCurrent();
            return source ? scopeGraphSource(source, assertCurrent, taskAllowsPath) : undefined;
        },
    };
    const optionalMethods = new Set<PropertyKey>([
        'getMemoryEvidenceEpoch', 'readLatestMemorySource', 'getGraphBoundarySnapshotSource',
    ]);
    const boundMethods = new Map<PropertyKey, { original: unknown; bound: unknown }>();
    return new Proxy(Object.create(host) as AiServiceHost, {
        get(_target, key) {
            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                if (optionalMethods.has(key) && typeof Reflect.get(host, key, host) !== 'function') return undefined;
                return Reflect.get(overrides, key);
            }
            const value = Reflect.get(host, key, host);
            if (typeof value !== 'function') return value;
            const cached = boundMethods.get(key);
            if (cached && cached.original === value) return cached.bound;
            const bound = value.bind(host);
            boundMethods.set(key, { original: value, bound });
            return bound;
        },
    });
}

function scopeGraphSource(
    source: GraphBoundarySnapshotSource,
    assertCurrent: () => void,
    taskAllowsPath: (path: string) => boolean,
): GraphBoundarySnapshotSource {
    const canonicalizePath = (path: string): string | null => {
        assertCurrent();
        const canonical = source.canonicalizePath(path);
        assertCurrent();
        return canonical && taskAllowsPath(canonical) ? canonical : null;
    };
    return {
        getEpoch() {
            assertCurrent();
            const epoch = source.getEpoch();
            assertCurrent();
            return epoch;
        },
        canonicalizePath,
        classifyPath(path) {
            const canonical = canonicalizePath(path);
            if (!canonical) return 'blocked';
            const classification = source.classifyPath(canonical);
            assertCurrent();
            if (!taskAllowsPath(canonical)) return 'blocked';
            return classification;
        },
        get resolvedLinks() {
            assertCurrent();
            const links = source.resolvedLinks;
            assertCurrent();
            // Enumerate source keys without touching excluded rows. Values are
            // acquired lazily by the existing budgeted snapshot builder.
            return new Proxy(Object.create(null) as Record<string, ResolvedLinkTargets>, {
                ownKeys() {
                    assertCurrent();
                    const paths = links instanceof Map ? [...links.keys()] : Object.keys(links);
                    const allowed = paths.filter(path => canonicalizePath(path) !== null);
                    assertCurrent();
                    return allowed;
                },
                getOwnPropertyDescriptor(_target, key) {
                    if (typeof key !== 'string' || !canonicalizePath(key) || !hasGraphSource(links, key)) return undefined;
                    return { configurable: true, enumerable: true };
                },
                get(_target, key) {
                    if (typeof key !== 'string' || !canonicalizePath(key) || !hasGraphSource(links, key)) return undefined;
                    const targets = links instanceof Map ? links.get(key)! : (links as Readonly<Record<string, ResolvedLinkTargets>>)[key];
                    assertCurrent();
                    if (!canonicalizePath(key)) throw new Error('Task graph source is no longer admitted.');
                    // Link weights are unnecessary here. In particular, never
                    // read an excluded target's property value to discard it.
                    const paths = Array.isArray(targets) || targets instanceof Set
                        ? [...targets] : Object.keys(targets);
                    const allowed = paths.filter(path => canonicalizePath(path) !== null);
                    assertCurrent();
                    if (!canonicalizePath(key)) throw new Error('Task graph source is no longer admitted.');
                    return Object.freeze(allowed);
                },
            });
        },
    };
}

function hasGraphSource(links: ResolvedLinksInput, path: string): boolean {
    return links instanceof Map ? links.has(path) : Object.prototype.hasOwnProperty.call(links, path);
}
