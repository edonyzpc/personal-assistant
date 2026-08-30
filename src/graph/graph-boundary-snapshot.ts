import type {
    GraphBoundarySnapshot,
    GraphPathClass,
} from "./personalized-pagerank";
import { waitForInterruptibleMacrotask } from "./interruptible-macrotask";
import { RETRIEVAL_CALIBRATION_PROFILE } from "../vss/retrieval-calibration";

export type ResolvedLinkTargets =
    | ReadonlySet<string>
    | readonly string[]
    | Readonly<Record<string, unknown>>;

export type ResolvedLinksInput =
    | ReadonlyMap<string, ResolvedLinkTargets>
    | Readonly<Record<string, ResolvedLinkTargets>>;

export interface GraphBoundarySnapshotLimits {
    maxSnapshotNodes: number;
    maxSnapshotEdges: number;
    maxSnapshotBytes: number;
    absoluteDeadlineMs: number;
    checkpointEvery?: number;
}

export interface GraphBoundarySnapshotSource {
    getEpoch(): string;
    resolvedLinks: ResolvedLinksInput;
    classifyPath(path: string): GraphPathClass;
    canonicalizePath(path: string): string | null;
}

export interface GraphBoundarySnapshotBuildOptions {
    signal?: AbortSignal;
    now?: () => number;
    yieldMacrotask?: () => Promise<void>;
}

export interface GraphBoundarySnapshotBuildEstimate {
    snapshotNodes: number;
    snapshotEdges: number;
    snapshotBytes: number;
    remainingMillis: number;
}

export type GraphBoundarySnapshotBuildResult =
    | { ok: true; snapshot: GraphBoundarySnapshot; estimate: GraphBoundarySnapshotBuildEstimate }
    | {
        ok: false;
        reason: "aborted" | "deadline" | "snapshot_budget" | "epoch_changed" | "invalid_snapshot";
        estimate: GraphBoundarySnapshotBuildEstimate;
    };

const SNAPSHOT_NODE_OVERHEAD_BYTES = 32;
const SNAPSHOT_EDGE_OVERHEAD_BYTES = 24;
const SNAPSHOT_ENUM_ENTRY_BYTES = 24;
const SNAPSHOT_SORT_REFERENCE_BYTES = 8;

/**
 * Streams live topology into a bounded provisional copy. It never returns a
 * partial snapshot and only seals after the live epoch is rechecked.
 */
export async function buildGraphBoundarySnapshot(
    source: GraphBoundarySnapshotSource,
    limits: GraphBoundarySnapshotLimits,
    options: GraphBoundarySnapshotBuildOptions = {},
): Promise<GraphBoundarySnapshotBuildResult> {
    const now = options.now ?? Date.now;
    const checkpointEvery = Math.max(1, Math.floor(
        limits.checkpointEvery ?? RETRIEVAL_CALIBRATION_PROFILE.graph.cooperativeCheckpointEvery,
    ));
    const startedEpoch = source.getEpoch();
    const pathClasses = new Map<string, GraphPathClass>();
    const canonicalLinks = new Map<string, Set<string>>();
    let snapshotEdges = 0;
    let retainedBytes = 0;
    let workingBytes = 0;
    let peakBytes = 0;
    let operations = 0;

    const updatePeakBytes = () => {
        peakBytes = Math.max(peakBytes, retainedBytes + workingBytes);
    };
    const addRetainedBytes = (bytes: number) => {
        retainedBytes += bytes;
        updatePeakBytes();
    };
    const addWorkingBytes = (bytes: number) => {
        workingBytes += bytes;
        updatePeakBytes();
    };
    const releaseWorkingBytes = (bytes: number) => {
        workingBytes = Math.max(0, workingBytes - bytes);
    };

    const estimate = (): GraphBoundarySnapshotBuildEstimate => ({
        snapshotNodes: pathClasses.size,
        snapshotEdges,
        snapshotBytes: peakBytes,
        remainingMillis: limits.absoluteDeadlineMs - now(),
    });
    const fail = (reason: Exclude<GraphBoundarySnapshotBuildResult, { ok: true }>["reason"]): GraphBoundarySnapshotBuildResult => ({
        ok: false,
        reason,
        estimate: estimate(),
    });
    const currentFailure = (): GraphBoundarySnapshotBuildResult | null => {
        if (options.signal?.aborted) return fail("aborted");
        if (now() >= limits.absoluteDeadlineMs) return fail("deadline");
        if (source.getEpoch() !== startedEpoch) return fail("epoch_changed");
        if (
            pathClasses.size > limits.maxSnapshotNodes
            || snapshotEdges > limits.maxSnapshotEdges
            || peakBytes > limits.maxSnapshotBytes
        ) return fail("snapshot_budget");
        return null;
    };
    const checkpoint = async (): Promise<GraphBoundarySnapshotBuildResult | null> => {
        operations += 1;
        const before = currentFailure();
        if (before) return before;
        if (operations % checkpointEvery !== 0) return null;
        const yieldOutcome = await waitForInterruptibleMacrotask({
            yieldMacrotask: options.yieldMacrotask,
            signal: options.signal,
            absoluteDeadlineMs: limits.absoluteDeadlineMs,
            now,
        });
        if (yieldOutcome === "aborted") return fail("aborted");
        if (yieldOutcome === "deadline") return fail("deadline");
        return currentFailure();
    };
    const observePath = (rawPath: string): string | null => {
        const canonicalPath = source.canonicalizePath(rawPath);
        if (!canonicalPath) return null;
        if (!pathClasses.has(canonicalPath)) {
            const pathClass = source.classifyPath(canonicalPath);
            if (!isGraphPathClass(pathClass)) return null;
            pathClasses.set(canonicalPath, pathClass);
            addRetainedBytes(utf8Length(canonicalPath) + SNAPSHOT_NODE_OVERHEAD_BYTES);
        }
        return canonicalPath;
    };

    const initialFailure = currentFailure();
    if (initialFailure) return initialFailure;
    let sourceEntriesWorkingBytes = 0;
    try {
        // Enumerate only shallow references first, then acquire/classify in
        // canonical order. Live insertion order cannot choose which prefix is
        // copied before a deadline or checkpoint.
        const sourceEntries: Array<{
            rawSource: string;
            canonicalSource: string;
            rawTargets: ResolvedLinkTargets;
        }> = [];
        for (const [rawSource, rawTargets] of iterateResolvedLinks(source.resolvedLinks)) {
            const canonicalSource = source.canonicalizePath(rawSource);
            if (!canonicalSource) return fail("invalid_snapshot");
            const bytes = SNAPSHOT_ENUM_ENTRY_BYTES + utf8Length(canonicalSource);
            sourceEntriesWorkingBytes += bytes;
            addWorkingBytes(bytes);
            sourceEntries.push({ rawSource, canonicalSource, rawTargets });
            if (sourceEntries.length > limits.maxSnapshotNodes) return fail("snapshot_budget");
            const sourceEnumerationCheckpoint = await checkpoint();
            if (sourceEnumerationCheckpoint) return sourceEnumerationCheckpoint;
        }
        const sourceSortAuxBytes = sourceEntries.length * SNAPSHOT_SORT_REFERENCE_BYTES;
        addWorkingBytes(sourceSortAuxBytes);
        const sourceSortFailure = await cooperativeSortInPlace(sourceEntries, (left, right) => (
            compareCodePoint(left.canonicalSource, right.canonicalSource)
            || compareCodePoint(left.rawSource, right.rawSource)
        ), checkpoint);
        releaseWorkingBytes(sourceSortAuxBytes);
        if (sourceSortFailure) return sourceSortFailure;

        let enumeratedTargetCount = 0;
        for (const entry of sourceEntries) {
            const canonicalSource = observePath(entry.canonicalSource);
            if (!canonicalSource) return fail("invalid_snapshot");
            const sourceCheckpoint = await checkpoint();
            if (sourceCheckpoint) return sourceCheckpoint;

            const targetEntries: Array<{ rawTarget: string; canonicalTarget: string }> = [];
            let targetEntriesWorkingBytes = 0;
            for (const rawTarget of iterateTargets(entry.rawTargets)) {
                enumeratedTargetCount += 1;
                if (enumeratedTargetCount > limits.maxSnapshotEdges) return fail("snapshot_budget");
                const canonicalTarget = source.canonicalizePath(rawTarget);
                if (!canonicalTarget) return fail("invalid_snapshot");
                const bytes = SNAPSHOT_ENUM_ENTRY_BYTES + utf8Length(canonicalTarget);
                targetEntriesWorkingBytes += bytes;
                addWorkingBytes(bytes);
                targetEntries.push({ rawTarget, canonicalTarget });
                const targetEnumerationCheckpoint = await checkpoint();
                if (targetEnumerationCheckpoint) return targetEnumerationCheckpoint;
            }
            const targetSortAuxBytes = targetEntries.length * SNAPSHOT_SORT_REFERENCE_BYTES;
            addWorkingBytes(targetSortAuxBytes);
            const targetSortFailure = await cooperativeSortInPlace(targetEntries, (left, right) => (
                compareCodePoint(left.canonicalTarget, right.canonicalTarget)
                || compareCodePoint(left.rawTarget, right.rawTarget)
            ), checkpoint);
            releaseWorkingBytes(targetSortAuxBytes);
            if (targetSortFailure) return targetSortFailure;

            let targets = canonicalLinks.get(canonicalSource);
            if (!targets) {
                targets = new Set<string>();
                canonicalLinks.set(canonicalSource, targets);
            }
            for (const entryTarget of targetEntries) {
                const canonicalTarget = observePath(entryTarget.canonicalTarget);
                if (!canonicalTarget) return fail("invalid_snapshot");
                if (!targets.has(canonicalTarget)) {
                    targets.add(canonicalTarget);
                    snapshotEdges += 1;
                    addRetainedBytes(SNAPSHOT_EDGE_OVERHEAD_BYTES);
                }
                const edgeCheckpoint = await checkpoint();
                if (edgeCheckpoint) return edgeCheckpoint;
            }
            releaseWorkingBytes(targetEntriesWorkingBytes);
        }
        releaseWorkingBytes(sourceEntriesWorkingBytes);
    } catch {
        return fail("invalid_snapshot");
    }

    const finalFailure = currentFailure();
    if (finalFailure) return finalFailure;
    const canonicalPaths: string[] = [];
    let canonicalPathRefsBytes = 0;
    for (const path of pathClasses.keys()) {
        canonicalPaths.push(path);
        canonicalPathRefsBytes += SNAPSHOT_SORT_REFERENCE_BYTES;
        addWorkingBytes(SNAPSHOT_SORT_REFERENCE_BYTES);
        const pathCollectCheckpoint = await checkpoint();
        if (pathCollectCheckpoint) return pathCollectCheckpoint;
    }
    const canonicalPathSortAuxBytes = canonicalPaths.length * SNAPSHOT_SORT_REFERENCE_BYTES;
    addWorkingBytes(canonicalPathSortAuxBytes);
    const canonicalPathSortFailure = await cooperativeSortInPlace(canonicalPaths, compareCodePoint, checkpoint);
    releaseWorkingBytes(canonicalPathSortAuxBytes);
    if (canonicalPathSortFailure) return canonicalPathSortFailure;
    const sortedClasses: Array<readonly [string, GraphPathClass]> = [];
    let sortedClassRefsBytes = 0;
    for (const path of canonicalPaths) {
        sortedClasses.push([path, pathClasses.get(path)!]);
        sortedClassRefsBytes += SNAPSHOT_SORT_REFERENCE_BYTES * 2;
        addWorkingBytes(SNAPSHOT_SORT_REFERENCE_BYTES * 2);
        const classCollectCheckpoint = await checkpoint();
        if (classCollectCheckpoint) return classCollectCheckpoint;
    }
    pathClasses.clear();
    for (const [path, pathClass] of sortedClasses) {
        pathClasses.set(path, pathClass);
        const classCheckpoint = await checkpoint();
        if (classCheckpoint) return classCheckpoint;
    }

    const sortedSources: string[] = [];
    let sortedSourceRefsBytes = 0;
    for (const sourcePath of canonicalLinks.keys()) {
        sortedSources.push(sourcePath);
        sortedSourceRefsBytes += SNAPSHOT_SORT_REFERENCE_BYTES;
        addWorkingBytes(SNAPSHOT_SORT_REFERENCE_BYTES);
        const sourceCollectCheckpoint = await checkpoint();
        if (sourceCollectCheckpoint) return sourceCollectCheckpoint;
    }
    const sortedSourceAuxBytes = sortedSources.length * SNAPSHOT_SORT_REFERENCE_BYTES;
    addWorkingBytes(sortedSourceAuxBytes);
    const sortedSourceFailure = await cooperativeSortInPlace(sortedSources, compareCodePoint, checkpoint);
    releaseWorkingBytes(sortedSourceAuxBytes);
    if (sortedSourceFailure) return sortedSourceFailure;
    const sortedLinkRows: Array<[string, Set<string>]> = [];
    let sortedLinkRefsBytes = 0;
    for (const sourcePath of sortedSources) {
        const targets = canonicalLinks.get(sourcePath)!;
        const sortedTargets: string[] = [];
        let sortedTargetRefsBytes = 0;
        for (const targetPath of targets) {
            sortedTargets.push(targetPath);
            sortedTargetRefsBytes += SNAPSHOT_SORT_REFERENCE_BYTES;
            addWorkingBytes(SNAPSHOT_SORT_REFERENCE_BYTES);
            const targetCollectCheckpoint = await checkpoint();
            if (targetCollectCheckpoint) return targetCollectCheckpoint;
        }
        const sortedTargetAuxBytes = sortedTargets.length * SNAPSHOT_SORT_REFERENCE_BYTES;
        addWorkingBytes(sortedTargetAuxBytes);
        const sortedTargetFailure = await cooperativeSortInPlace(sortedTargets, compareCodePoint, checkpoint);
        releaseWorkingBytes(sortedTargetAuxBytes);
        if (sortedTargetFailure) return sortedTargetFailure;
        targets.clear();
        for (const targetPath of sortedTargets) {
            targets.add(targetPath);
            const targetSealCheckpoint = await checkpoint();
            if (targetSealCheckpoint) return targetSealCheckpoint;
        }
        releaseWorkingBytes(sortedTargetRefsBytes);
        sortedLinkRows.push([sourcePath, targets]);
        sortedLinkRefsBytes += SNAPSHOT_SORT_REFERENCE_BYTES * 2;
        addWorkingBytes(SNAPSHOT_SORT_REFERENCE_BYTES * 2);
    }
    canonicalLinks.clear();
    for (const [sourcePath, targets] of sortedLinkRows) {
        canonicalLinks.set(sourcePath, targets);
        const sourceSealCheckpoint = await checkpoint();
        if (sourceSealCheckpoint) return sourceSealCheckpoint;
    }

    const fingerprint = createRollingFingerprint();
    for (const path of canonicalPaths) {
        fingerprint.update("p\u0000");
        fingerprint.update(path);
        fingerprint.update("\u0000");
        fingerprint.update(pathClasses.get(path)!);
        fingerprint.update("\u0001");
        const pathFingerprintCheckpoint = await checkpoint();
        if (pathFingerprintCheckpoint) return pathFingerprintCheckpoint;
    }
    for (const [sourcePath, targets] of canonicalLinks) {
        for (const targetPath of targets) {
            fingerprint.update("e\u0000");
            fingerprint.update(sourcePath);
            fingerprint.update("\u0000");
            fingerprint.update(targetPath);
            fingerprint.update("\u0001");
            const edgeFingerprintCheckpoint = await checkpoint();
            if (edgeFingerprintCheckpoint) return edgeFingerprintCheckpoint;
        }
    }
    const sealingFailure = currentFailure();
    if (sealingFailure) return sealingFailure;
    const snapshot: GraphBoundarySnapshot = {
        epoch: startedEpoch,
        topologyFingerprint: fingerprint.digest(),
        resolvedLinks: Object.freeze(new ReadonlyGraphLinks(canonicalLinks)),
        pathClasses: Object.freeze(new ReadonlyMapView(pathClasses)),
        snapshotNodes: pathClasses.size,
        snapshotEdges,
        snapshotBytes: peakBytes,
    };
    releaseWorkingBytes(
        canonicalPathRefsBytes
        + sortedClassRefsBytes
        + sortedSourceRefsBytes
        + sortedLinkRefsBytes,
    );
    return { ok: true, snapshot: Object.freeze(snapshot), estimate: estimate() };
}

function* iterateResolvedLinks(input: ResolvedLinksInput): Iterable<[string, ResolvedLinkTargets]> {
    if (input instanceof Map) {
        for (const entry of input) yield entry;
        return;
    }
    const record = input as Readonly<Record<string, ResolvedLinkTargets>>;
    for (const source in record) {
        if (Object.prototype.hasOwnProperty.call(record, source)) yield [source, record[source]];
    }
}

function* iterateTargets(input: ResolvedLinkTargets): Iterable<string> {
    if (Array.isArray(input) || input instanceof Set) {
        for (const target of input) yield target;
        return;
    }
    for (const target in input) {
        if (Object.prototype.hasOwnProperty.call(input, target)) yield target;
    }
}

function isGraphPathClass(value: unknown): value is GraphPathClass {
    return value === "allowed_markdown"
        || value === "opaque_excluded_markdown"
        || value === "blocked";
}

function utf8Length(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function createRollingFingerprint(): { update(value: string): void; digest(): string } {
    // Two independent 32-bit FNV-1a lanes avoid materializing an O(E)
    // fingerprint payload while remaining deterministic across runtimes.
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    return {
        update(value: string) {
            for (let index = 0; index < value.length; index += 1) {
                const code = value.charCodeAt(index);
                first ^= code & 0xff;
                first = Math.imul(first, 0x01000193);
                first ^= code >>> 8;
                first = Math.imul(first, 0x01000193);
                second ^= code & 0xff;
                second = Math.imul(second, 0x85ebca6b);
                second ^= code >>> 8;
                second = Math.imul(second, 0xc2b2ae35);
            }
        },
        digest() {
            return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
        },
    };
}

async function cooperativeSortInPlace<T, F>(
    values: T[],
    compare: (left: T, right: T) => number,
    checkpoint: () => Promise<F | null>,
): Promise<F | null> {
    if (values.length < 2) return null;
    let source = values;
    let target = new Array<T>(values.length);
    for (let width = 1; width < values.length; width *= 2) {
        for (let start = 0; start < values.length; start += width * 2) {
            const middle = Math.min(start + width, values.length);
            const end = Math.min(start + width * 2, values.length);
            let left = start;
            let right = middle;
            let write = start;
            while (left < middle || right < end) {
                if (right >= end || (left < middle && compare(source[left], source[right]) <= 0)) {
                    target[write++] = source[left++];
                } else {
                    target[write++] = source[right++];
                }
                const failure = await checkpoint();
                if (failure) return failure;
            }
        }
        const swap = source;
        source = target;
        target = swap;
    }
    if (source !== values) {
        for (let index = 0; index < source.length; index += 1) {
            values[index] = source[index];
            const failure = await checkpoint();
            if (failure) return failure;
        }
    }
    return null;
}

class ReadonlySetView<T> implements ReadonlySet<T> {
    readonly #source: ReadonlySet<T>;

    constructor(source: ReadonlySet<T>) {
        this.#source = source;
    }

    get size(): number { return this.#source.size; }
    has(value: T): boolean { return this.#source.has(value); }
    entries(): SetIterator<[T, T]> { return this.#source.entries(); }
    keys(): SetIterator<T> { return this.#source.keys(); }
    values(): SetIterator<T> { return this.#source.values(); }
    [Symbol.iterator](): SetIterator<T> { return this.#source[Symbol.iterator](); }
    forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
        for (const value of this.#source) callbackfn.call(thisArg, value, value, this);
    }
}

class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
    readonly #source: ReadonlyMap<K, V>;

    constructor(source: ReadonlyMap<K, V>) {
        this.#source = source;
    }

    get size(): number { return this.#source.size; }
    get(key: K): V | undefined { return this.#source.get(key); }
    has(key: K): boolean { return this.#source.has(key); }
    entries(): MapIterator<[K, V]> { return this.#source.entries(); }
    keys(): MapIterator<K> { return this.#source.keys(); }
    values(): MapIterator<V> { return this.#source.values(); }
    [Symbol.iterator](): MapIterator<[K, V]> { return this.#source[Symbol.iterator](); }
    forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
        for (const [key, value] of this.#source) callbackfn.call(thisArg, value, key, this);
    }
}

class ReadonlyGraphLinks implements ReadonlyMap<string, ReadonlySet<string>> {
    readonly #source: ReadonlyMap<string, ReadonlySet<string>>;

    constructor(source: ReadonlyMap<string, ReadonlySet<string>>) {
        this.#source = source;
    }

    get size(): number { return this.#source.size; }
    get(key: string): ReadonlySet<string> | undefined {
        const value = this.#source.get(key);
        return value ? Object.freeze(new ReadonlySetView(value)) : undefined;
    }
    has(key: string): boolean { return this.#source.has(key); }
    *entries(): MapIterator<[string, ReadonlySet<string>]> {
        for (const [key, value] of this.#source) yield [key, Object.freeze(new ReadonlySetView(value))];
    }
    keys(): MapIterator<string> { return this.#source.keys(); }
    *values(): MapIterator<ReadonlySet<string>> {
        for (const value of this.#source.values()) yield Object.freeze(new ReadonlySetView(value));
    }
    [Symbol.iterator](): MapIterator<[string, ReadonlySet<string>]> { return this.entries(); }
    forEach(
        callbackfn: (value: ReadonlySet<string>, key: string, map: ReadonlyMap<string, ReadonlySet<string>>) => void,
        thisArg?: unknown,
    ): void {
        for (const [key, value] of this.#source) {
            callbackfn.call(thisArg, Object.freeze(new ReadonlySetView(value)), key, this);
        }
    }
}
