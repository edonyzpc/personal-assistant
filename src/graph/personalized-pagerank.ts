import { RETRIEVAL_CALIBRATION_PROFILE } from "../vss/retrieval-calibration";
import { waitForInterruptibleMacrotask } from "./interruptible-macrotask";

export type GraphPathClass =
    | "allowed_markdown"
    | "opaque_excluded_markdown"
    | "blocked";

export interface GraphBoundarySnapshot {
    epoch: string;
    topologyFingerprint: string;
    /** Canonical directed Markdown relations. Repeated mentions are already deduplicated. */
    resolvedLinks: ReadonlyMap<string, ReadonlySet<string>>;
    pathClasses: ReadonlyMap<string, GraphPathClass>;
    snapshotNodes: number;
    snapshotEdges: number;
    snapshotBytes: number;
}

export interface PPRState {
    path: string;
    opaqueUsed: boolean;
    nodeClass: "allowed" | "opaque";
}

export interface GraphWorkEstimate {
    snapshotNodes: number;
    snapshotEdges: number;
    snapshotBytes: number;
    canonicalNodes: number;
    canonicalEdges: number;
    liftedStates: number;
    legalTransitions: number;
    localCandidatePaths: number;
    projectedSolverOperations: number;
    projectedBytes: number;
    remainingMillis: number;
}

export interface GraphWorkLimits {
    maxSnapshotNodes: number;
    maxSnapshotEdges: number;
    maxSnapshotBytes: number;
    maxCanonicalNodes: number;
    maxCanonicalEdges: number;
    maxLiftedStates: number;
    maxLegalTransitions: number;
    maxLocalCandidatePaths: number;
    maxProjectedSolverOperations: number;
    maxProjectedBytes: number;
    absoluteDeadlineMs: number;
}

export interface BoundaryStateGraph {
    snapshotEpoch: string;
    topologyFingerprint: string;
    states: ReadonlyMap<string, PPRState>;
    transitions: ReadonlyMap<string, readonly PPRTransition[]>;
    allowedStateKeysByPath: ReadonlyMap<string, readonly string[]>;
    degrees: ReadonlyMap<string, number>;
    localCandidatePaths: ReadonlySet<string>;
    estimate: GraphWorkEstimate;
}

export interface PPRTransition {
    targetKey: string;
    probability: number;
}

export interface PPRSolveOptions {
    signal?: AbortSignal;
    absoluteDeadlineMs?: number;
    now?: () => number;
    alpha?: number;
    targetL1Error?: number;
    maxIterations?: number;
    massTolerance?: number;
    checkpointEvery?: number;
    yieldMacrotask?: () => Promise<void>;
}

export interface BoundaryStateGraphBuildOptions {
    signal?: AbortSignal;
    now?: () => number;
    checkpointEvery?: number;
    yieldMacrotask?: () => Promise<void>;
}

export type PPRSolveResult =
    | {
        converged: true;
        scores: ReadonlyMap<string, number>;
        iteration: number;
        errorBound: number;
    }
    | {
        converged: false;
        reason: "iteration_cap" | "aborted" | "deadline" | "invalid_graph" | "numeric_error";
    };

export type BoundaryStateGraphBuildResult =
    | { ok: true; graph: BoundaryStateGraph }
    | {
        ok: false;
        reason: "snapshot_budget" | "graph_budget" | "aborted" | "deadline" | "invalid_graph";
        estimate: GraphWorkEstimate;
    };

export const PPR_FOLLOW_ALPHA = 0.75;
export const PPR_TARGET_L1_ERROR = 0.001;
export const PPR_MAX_ITERATIONS = 50;

const PROJECTED_STATE_BYTES = 96;
const PROJECTED_TRANSITION_BYTES = 32;
const PROJECTED_PATH_INDEX_BYTES = 64;
const PROJECTED_EDGE_INDEX_BYTES = 48;
const PROJECTED_NEIGHBOR_ENTRY_BYTES = 40;
const PROJECTED_DEGREE_ENTRY_BYTES = 32;

export async function buildBoundaryStateGraph(
    snapshot: GraphBoundarySnapshot,
    seedPaths: readonly string[],
    directPaths: ReadonlySet<string>,
    limits: GraphWorkLimits,
    options: BoundaryStateGraphBuildOptions = {},
): Promise<BoundaryStateGraphBuildResult> {
    const now = options.now ?? Date.now;
    const seeds = unique(seedPaths).filter((path) => snapshot.pathClasses.get(path) === "allowed_markdown");
    const seedSet = new Set(seeds);
    const directSet = new Set([...directPaths].filter((path) => snapshot.pathClasses.get(path) === "allowed_markdown"));
    const remaining = () => limits.absoluteDeadlineMs - now();
    const baseEstimate = (): GraphWorkEstimate => ({
        snapshotNodes: snapshot.snapshotNodes,
        snapshotEdges: snapshot.snapshotEdges,
        snapshotBytes: snapshot.snapshotBytes,
        canonicalNodes: 0,
        canonicalEdges: 0,
        liftedStates: 0,
        legalTransitions: 0,
        localCandidatePaths: 0,
        projectedSolverOperations: 0,
        projectedBytes: 0,
        remainingMillis: remaining(),
    });
    let estimate = baseEstimate();
    const checkpoint = createCooperativeCheckpoint({
        signal: options.signal,
        absoluteDeadlineMs: limits.absoluteDeadlineMs,
        now,
        checkpointEvery: options.checkpointEvery,
        yieldMacrotask: options.yieldMacrotask,
    });
    const checkpointFailure = async (): Promise<BoundaryStateGraphBuildResult | null> => {
        const reason = await checkpoint();
        return reason ? { ok: false, reason, estimate: { ...estimate, remainingMillis: remaining() } } : null;
    };
    if (options.signal?.aborted) return { ok: false, reason: "aborted", estimate };
    if (remaining() <= 0) return { ok: false, reason: "deadline", estimate };
    if (
        snapshot.snapshotNodes > limits.maxSnapshotNodes
        || snapshot.snapshotEdges > limits.maxSnapshotEdges
        || snapshot.snapshotBytes > limits.maxSnapshotBytes
    ) {
        return { ok: false, reason: "snapshot_budget", estimate };
    }
    if (
        !snapshot.epoch
        || !snapshot.topologyFingerprint
        || !Number.isInteger(snapshot.snapshotNodes)
        || snapshot.snapshotNodes < 0
        || snapshot.snapshotNodes !== snapshot.pathClasses.size
        || !Number.isInteger(snapshot.snapshotEdges)
        || snapshot.snapshotEdges < 0
        || !Number.isFinite(snapshot.snapshotBytes)
        || snapshot.snapshotBytes < 0
    ) {
        return { ok: false, reason: "invalid_graph", estimate };
    }
    if (seeds.length === 0 || seeds.length > 3) return { ok: false, reason: "invalid_graph", estimate };

    let substrateProjectedBytes = snapshot.snapshotBytes;
    const eligiblePaths: string[] = [];
    for (const [path, pathClass] of snapshot.pathClasses) {
        if (pathClass !== "blocked") {
            eligiblePaths.push(path);
            substrateProjectedBytes += PROJECTED_PATH_INDEX_BYTES + path.length * 2;
            estimate = { ...estimate, projectedBytes: substrateProjectedBytes, remainingMillis: remaining() };
            if (estimate.projectedBytes > limits.maxProjectedBytes) {
                return { ok: false, reason: "graph_budget", estimate };
            }
        }
        const eligibleFailure = await checkpointFailure();
        if (eligibleFailure) return eligibleFailure;
    }
    const eligibleSortFailure = await cooperativeSortInPlace(eligiblePaths, comparePath, checkpoint);
    if (eligibleSortFailure) {
        return { ok: false, reason: eligibleSortFailure, estimate: { ...estimate, remainingMillis: remaining() } };
    }
    const eligibleSet = new Set<string>();
    for (const path of eligiblePaths) {
        eligibleSet.add(path);
        const eligibleIndexFailure = await checkpointFailure();
        if (eligibleIndexFailure) return eligibleIndexFailure;
    }
    estimate = { ...estimate, projectedBytes: substrateProjectedBytes, remainingMillis: remaining() };
    if (estimate.projectedBytes > limits.maxProjectedBytes) {
        return { ok: false, reason: "graph_budget", estimate };
    }
    const directed = new Set<string>();
    let observedSnapshotEdges = 0;
    const sortedSources: string[] = [];
    for (const source of snapshot.resolvedLinks.keys()) {
        sortedSources.push(source);
        const sourceCollectFailure = await checkpointFailure();
        if (sourceCollectFailure) return sourceCollectFailure;
    }
    const sourceSortFailure = await cooperativeSortInPlace(sortedSources, comparePath, checkpoint);
    if (sourceSortFailure) {
        return { ok: false, reason: sourceSortFailure, estimate: { ...estimate, remainingMillis: remaining() } };
    }
    for (const source of sortedSources) {
        const sourceFailure = await checkpointFailure();
        if (sourceFailure) return sourceFailure;
        if (!snapshot.pathClasses.has(source)) {
            return { ok: false, reason: "invalid_graph", estimate };
        }
        const targets: string[] = [];
        for (const target of snapshot.resolvedLinks.get(source) ?? new Set<string>()) {
            targets.push(target);
            const targetCollectFailure = await checkpointFailure();
            if (targetCollectFailure) return targetCollectFailure;
        }
        const targetSortFailure = await cooperativeSortInPlace(targets, comparePath, checkpoint);
        if (targetSortFailure) {
            return { ok: false, reason: targetSortFailure, estimate: { ...estimate, remainingMillis: remaining() } };
        }
        for (const target of targets) {
            const targetFailure = await checkpointFailure();
            if (targetFailure) return targetFailure;
            if (!snapshot.pathClasses.has(target)) {
                return { ok: false, reason: "invalid_graph", estimate };
            }
            observedSnapshotEdges += 1;
            if (!eligibleSet.has(source) || !eligibleSet.has(target)) continue;
            const encoded = edgeKey(source, target);
            if (!directed.has(encoded)) {
                directed.add(encoded);
                substrateProjectedBytes += PROJECTED_EDGE_INDEX_BYTES + encoded.length * 2;
                estimate = { ...estimate, projectedBytes: substrateProjectedBytes, remainingMillis: remaining() };
                if (estimate.projectedBytes > limits.maxProjectedBytes) {
                    return { ok: false, reason: "graph_budget", estimate };
                }
            }
        }
    }
    if (observedSnapshotEdges !== snapshot.snapshotEdges) {
        return { ok: false, reason: "invalid_graph", estimate };
    }

    const neighbors = new Map<string, Map<string, number>>();
    const degrees = new Map<string, number>();
    const unorderedPairs = new Set<string>();
    for (const encoded of directed) {
        const edgeFailure = await checkpointFailure();
        if (edgeFailure) return edgeFailure;
        const [source, target] = decodeEdgeKey(encoded);
        const pair = pairKey(source, target);
        if (!unorderedPairs.has(pair)) {
            unorderedPairs.add(pair);
            substrateProjectedBytes += PROJECTED_EDGE_INDEX_BYTES + pair.length * 2;
            estimate = { ...estimate, projectedBytes: substrateProjectedBytes, remainingMillis: remaining() };
            if (estimate.projectedBytes > limits.maxProjectedBytes) {
                return { ok: false, reason: "graph_budget", estimate };
            }
        }
    }
    const sortedPairs: string[] = [];
    for (const pair of unorderedPairs) {
        sortedPairs.push(pair);
        const pairCollectFailure = await checkpointFailure();
        if (pairCollectFailure) return pairCollectFailure;
    }
    const pairSortFailure = await cooperativeSortInPlace(sortedPairs, comparePath, checkpoint);
    if (pairSortFailure) {
        return { ok: false, reason: pairSortFailure, estimate: { ...estimate, remainingMillis: remaining() } };
    }
    for (const encodedPair of sortedPairs) {
        const pairFailure = await checkpointFailure();
        if (pairFailure) return pairFailure;
        const [left, right] = decodePairKey(encodedPair);
        const reciprocal = directed.has(edgeKey(left, right)) && directed.has(edgeKey(right, left));
        const multiplicity = reciprocal ? 2 : 1;
        addNeighbor(neighbors, left, right, multiplicity);
        substrateProjectedBytes += PROJECTED_NEIGHBOR_ENTRY_BYTES;
        if (left !== right) {
            addNeighbor(neighbors, right, left, multiplicity);
            substrateProjectedBytes += PROJECTED_NEIGHBOR_ENTRY_BYTES;
        }
        if (!degrees.has(left)) substrateProjectedBytes += PROJECTED_DEGREE_ENTRY_BYTES;
        degrees.set(left, (degrees.get(left) ?? 0) + multiplicity);
        if (left !== right) {
            if (!degrees.has(right)) substrateProjectedBytes += PROJECTED_DEGREE_ENTRY_BYTES;
            degrees.set(right, (degrees.get(right) ?? 0) + multiplicity);
        }
        estimate = { ...estimate, projectedBytes: substrateProjectedBytes, remainingMillis: remaining() };
        if (estimate.projectedBytes > limits.maxProjectedBytes) {
            return { ok: false, reason: "graph_budget", estimate };
        }
    }
    for (const [path, adjacent] of neighbors) {
        const degreeFailure = await checkpointFailure();
        if (degreeFailure) return degreeFailure;
        if ((degrees.get(path) ?? 0) <= 0 && adjacent.size > 0) {
            return { ok: false, reason: "invalid_graph", estimate };
        }
    }

    const states = new Map<string, PPRState>();
    const transitions = new Map<string, readonly PPRTransition[]>();
    const allowedStateKeysByPath = new Map<string, string[]>();
    const queue: string[] = [];
    const enqueue = (state: PPRState) => {
        const key = getPprStateKey(state.path, state.opaqueUsed);
        if (states.has(key)) return key;
        states.set(key, state);
        queue.push(key);
        if (state.nodeClass === "allowed") {
            const keys = allowedStateKeysByPath.get(state.path) ?? [];
            keys.push(key);
            allowedStateKeysByPath.set(state.path, keys);
        }
        return key;
    };
    for (const seed of seeds) enqueue({ path: seed, opaqueUsed: false, nodeClass: "allowed" });
    if (states.size > limits.maxLiftedStates) {
        estimate = {
            ...estimate,
            liftedStates: states.size,
            projectedBytes: substrateProjectedBytes + states.size * PROJECTED_STATE_BYTES,
            remainingMillis: remaining(),
        };
        return { ok: false, reason: "graph_budget", estimate };
    }

    const localCandidatePaths = new Set<string>();
    const canonicalEnvelopePaths = new Set<string>(seeds);
    const canonicalEnvelopeEdges = new Set<string>();
    let cursor = 0;
    let legalTransitionCount = 0;
    while (cursor < queue.length) {
        const stateFailure = await checkpointFailure();
        if (stateFailure) return stateFailure;
        const key = queue[cursor++];
        const state = states.get(key)!;
        const adjacent = neighbors.get(state.path) ?? new Map<string, number>();
        canonicalEnvelopePaths.add(state.path);
        for (const targetPath of adjacent.keys()) {
            const envelopeFailure = await checkpointFailure();
            if (envelopeFailure) return envelopeFailure;
            canonicalEnvelopePaths.add(targetPath);
            canonicalEnvelopeEdges.add(pairKey(state.path, targetPath));
            if (
                canonicalEnvelopePaths.size > limits.maxCanonicalNodes
                || canonicalEnvelopeEdges.size > limits.maxCanonicalEdges
            ) {
                estimate = {
                    ...estimate,
                    canonicalNodes: canonicalEnvelopePaths.size,
                    canonicalEdges: canonicalEnvelopeEdges.size,
                    remainingMillis: remaining(),
                };
                return { ok: false, reason: "graph_budget", estimate };
            }
        }
        const weighted: Array<{ targetKey: string; weight: number }> = [];
        const sortedAdjacent: Array<[string, number]> = [];
        for (const entry of adjacent.entries()) {
            sortedAdjacent.push(entry);
            const adjacentCollectFailure = await checkpointFailure();
            if (adjacentCollectFailure) return adjacentCollectFailure;
        }
        const adjacentSortFailure = await cooperativeSortInPlace(
            sortedAdjacent,
            ([leftPath], [rightPath]) => comparePath(leftPath, rightPath),
            checkpoint,
        );
        if (adjacentSortFailure) {
            return { ok: false, reason: adjacentSortFailure, estimate: { ...estimate, remainingMillis: remaining() } };
        }
        for (const [targetPath, multiplicity] of sortedAdjacent) {
            const transitionFailure = await checkpointFailure();
            if (transitionFailure) return transitionFailure;
            const targetClass = snapshot.pathClasses.get(targetPath);
            const target = legalTargetState(state, targetPath, targetClass);
            if (!target) continue;
            const targetDegree = degrees.get(targetPath) ?? 0;
            const sourceDegree = degrees.get(state.path) ?? 0;
            if (targetDegree <= 0 || sourceDegree <= 0 || multiplicity <= 0) {
                return { ok: false, reason: "invalid_graph", estimate };
            }
            const targetKey = enqueue(target);
            const weight = multiplicity / (sourceDegree * Math.sqrt(targetDegree));
            if (!Number.isFinite(weight) || weight <= 0) return { ok: false, reason: "invalid_graph", estimate };
            weighted.push({ targetKey, weight });
            if (
                seedSet.has(state.path)
                && !state.opaqueUsed
                && state.nodeClass === "allowed"
                && target.nodeClass === "allowed"
                && !directSet.has(targetPath)
            ) {
                localCandidatePaths.add(targetPath);
            }
            const prospectiveLegalTransitions = legalTransitionCount + weighted.length;
            estimate = {
                ...estimate,
                liftedStates: states.size,
                legalTransitions: prospectiveLegalTransitions,
                localCandidatePaths: localCandidatePaths.size,
                projectedSolverOperations: projectedSolverOperations(
                    seeds.length,
                    states.size,
                    prospectiveLegalTransitions,
                ),
                projectedBytes: substrateProjectedBytes
                    + states.size * PROJECTED_STATE_BYTES
                    + prospectiveLegalTransitions * PROJECTED_TRANSITION_BYTES,
                remainingMillis: remaining(),
            };
            if (
                estimate.liftedStates > limits.maxLiftedStates
                || estimate.legalTransitions > limits.maxLegalTransitions
                || estimate.projectedSolverOperations > limits.maxProjectedSolverOperations
                || estimate.projectedBytes > limits.maxProjectedBytes
            ) return { ok: false, reason: "graph_budget", estimate };
        }
        let total = 0;
        for (const item of weighted) {
            total += item.weight;
            const totalFailure = await checkpointFailure();
            if (totalFailure) return totalFailure;
        }
        const row: PPRTransition[] = [];
        if (total > 0) {
            for (const item of weighted) {
                row.push({ targetKey: item.targetKey, probability: item.weight / total });
                const rowFailure = await checkpointFailure();
                if (rowFailure) return rowFailure;
            }
        }
        transitions.set(key, row);
        legalTransitionCount += row.length;
        estimate = {
            ...estimate,
            canonicalNodes: canonicalEnvelopePaths.size,
            canonicalEdges: canonicalEnvelopeEdges.size,
            liftedStates: states.size,
            legalTransitions: legalTransitionCount,
            localCandidatePaths: localCandidatePaths.size,
            projectedSolverOperations: projectedSolverOperations(
                seeds.length,
                states.size,
                legalTransitionCount,
            ),
            projectedBytes: substrateProjectedBytes
                + states.size * PROJECTED_STATE_BYTES
                + legalTransitionCount * PROJECTED_TRANSITION_BYTES,
            remainingMillis: remaining(),
        };
        if (
            estimate.liftedStates > limits.maxLiftedStates
            || estimate.legalTransitions > limits.maxLegalTransitions
            || estimate.projectedSolverOperations > limits.maxProjectedSolverOperations
            || estimate.projectedBytes > limits.maxProjectedBytes
        ) return { ok: false, reason: "graph_budget", estimate };
    }

    return {
        ok: true,
        graph: {
            snapshotEpoch: snapshot.epoch,
            topologyFingerprint: snapshot.topologyFingerprint,
            states,
            transitions,
            allowedStateKeysByPath,
            degrees,
            localCandidatePaths,
            estimate: { ...estimate, remainingMillis: remaining() },
        },
    };
}

export async function solvePersonalizedPageRank(
    graph: BoundaryStateGraph,
    seedPath: string,
    options: PPRSolveOptions = {},
): Promise<PPRSolveResult> {
    const alpha = options.alpha ?? PPR_FOLLOW_ALPHA;
    const restart = 1 - alpha;
    const targetL1Error = options.targetL1Error ?? PPR_TARGET_L1_ERROR;
    const maxIterations = options.maxIterations ?? PPR_MAX_ITERATIONS;
    const massTolerance = options.massTolerance ?? 1e-8;
    const now = options.now ?? Date.now;
    const checkpoint = createCooperativeCheckpoint({
        signal: options.signal,
        absoluteDeadlineMs: options.absoluteDeadlineMs,
        now,
        checkpointEvery: options.checkpointEvery,
        yieldMacrotask: options.yieldMacrotask,
    });
    const seedKey = getPprStateKey(seedPath, false);
    if (
        !graph.states.has(seedKey)
        || alpha !== PPR_FOLLOW_ALPHA
        || targetL1Error <= 0
        || targetL1Error > PPR_TARGET_L1_ERROR
        || maxIterations <= 0
        || maxIterations > PPR_MAX_ITERATIONS
        || (
            options.absoluteDeadlineMs !== undefined
            && !Number.isFinite(options.absoluteDeadlineMs)
        )
    ) {
        return { converged: false, reason: "invalid_graph" };
    }

    let current = new Map<string, number>([[seedKey, 1]]);
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        if (options.signal?.aborted) return { converged: false, reason: "aborted" };
        if (options.absoluteDeadlineMs !== undefined && now() >= options.absoluteDeadlineMs) {
            return { converged: false, reason: "deadline" };
        }
        const next = new Map<string, number>([[seedKey, restart]]);
        for (const [sourceKey, mass] of current) {
            const sourceFailure = await checkpoint();
            if (sourceFailure) return { converged: false, reason: sourceFailure };
            if (!Number.isFinite(mass) || mass < -massTolerance) return { converged: false, reason: "numeric_error" };
            const row = graph.transitions.get(sourceKey) ?? [];
            if (row.length === 0) {
                next.set(seedKey, (next.get(seedKey) ?? 0) + alpha * mass);
                continue;
            }
            for (const transition of row) {
                const transitionFailure = await checkpoint();
                if (transitionFailure) return { converged: false, reason: transitionFailure };
                const contribution = alpha * mass * transition.probability;
                if (!Number.isFinite(contribution) || contribution < -massTolerance) {
                    return { converged: false, reason: "numeric_error" };
                }
                next.set(transition.targetKey, (next.get(transition.targetKey) ?? 0) + contribution);
            }
        }
        let mass = 0;
        for (const value of next.values()) {
            mass += value;
            const massFailure = await checkpoint();
            if (massFailure) return { converged: false, reason: massFailure };
        }
        if (!Number.isFinite(mass) || Math.abs(mass - 1) > massTolerance) {
            return { converged: false, reason: "numeric_error" };
        }
        let rawDelta = 0;
        for (const [key, value] of next) {
            rawDelta += Math.abs(value - (current.get(key) ?? 0));
            const deltaFailure = await checkpoint();
            if (deltaFailure) return { converged: false, reason: deltaFailure };
        }
        for (const [key, value] of current) {
            if (!next.has(key)) rawDelta += Math.abs(value);
            const deltaFailure = await checkpoint();
            if (deltaFailure) return { converged: false, reason: deltaFailure };
        }
        const errorBound = (alpha / restart) * rawDelta;
        if (errorBound <= targetL1Error) {
            const scores = new Map<string, number>();
            for (const [path, keys] of graph.allowedStateKeysByPath) {
                let score = 0;
                for (const key of keys) {
                    score += next.get(key) ?? 0;
                    const scoreFailure = await checkpoint();
                    if (scoreFailure) return { converged: false, reason: scoreFailure };
                }
                if (score > 0) scores.set(path, score);
                const pathScoreFailure = await checkpoint();
                if (pathScoreFailure) return { converged: false, reason: pathScoreFailure };
            }
            return { converged: true, scores, iteration, errorBound };
        }
        current = next;
    }
    return { converged: false, reason: "iteration_cap" };
}

function legalTargetState(
    source: PPRState,
    targetPath: string,
    targetClass: GraphPathClass | undefined,
): PPRState | null {
    if (targetClass === "allowed_markdown") {
        return { path: targetPath, opaqueUsed: source.opaqueUsed, nodeClass: "allowed" };
    }
    if (
        targetClass === "opaque_excluded_markdown"
        && source.nodeClass === "allowed"
        && !source.opaqueUsed
    ) {
        return { path: targetPath, opaqueUsed: true, nodeClass: "opaque" };
    }
    return null;
}

export function getPprStateKey(path: string, opaqueUsed: boolean): string {
    return `${opaqueUsed ? "1" : "0"}\u0000${path}`;
}

function edgeKey(source: string, target: string): string {
    return `${source}\u0000${target}`;
}

function decodeEdgeKey(value: string): [string, string] {
    const split = value.indexOf("\u0000");
    return [value.slice(0, split), value.slice(split + 1)];
}

function pairKey(left: string, right: string): string {
    return comparePath(left, right) <= 0 ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function decodePairKey(value: string): [string, string] {
    return decodeEdgeKey(value);
}

function addNeighbor(
    neighbors: Map<string, Map<string, number>>,
    source: string,
    target: string,
    multiplicity: number,
): void {
    const row = neighbors.get(source) ?? new Map<string, number>();
    row.set(target, multiplicity);
    neighbors.set(source, row);
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

function comparePath(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function projectedSolverOperations(
    seedCount: number,
    liftedStateCount: number,
    legalTransitionCount: number,
): number {
    // Each seed lane can visit every lifted state and every legal transition
    // on every iteration. Counting only transitions underestimates sparse and
    // dangling graphs, where state bookkeeping and convergence scans dominate.
    return seedCount
        * PPR_MAX_ITERATIONS
        * (liftedStateCount + legalTransitionCount);
}

interface CooperativeCheckpointOptions {
    signal?: AbortSignal;
    absoluteDeadlineMs?: number;
    now: () => number;
    checkpointEvery?: number;
    yieldMacrotask?: () => Promise<void>;
}

function createCooperativeCheckpoint(
    options: CooperativeCheckpointOptions,
): () => Promise<"aborted" | "deadline" | null> {
    const checkpointEvery = Math.max(1, Math.floor(
        options.checkpointEvery ?? RETRIEVAL_CALIBRATION_PROFILE.graph.cooperativeCheckpointEvery,
    ));
    let operations = 0;
    const currentFailure = (): "aborted" | "deadline" | null => {
        if (options.signal?.aborted) return "aborted";
        if (options.absoluteDeadlineMs !== undefined && options.now() >= options.absoluteDeadlineMs) return "deadline";
        return null;
    };
    return async () => {
        operations += 1;
        const before = currentFailure();
        if (before) return before;
        if (operations % checkpointEvery !== 0) return null;
        const yieldOutcome = await waitForInterruptibleMacrotask({
            yieldMacrotask: options.yieldMacrotask,
            signal: options.signal,
            absoluteDeadlineMs: options.absoluteDeadlineMs,
            now: options.now,
        });
        if (yieldOutcome !== "yielded") return yieldOutcome;
        return currentFailure();
    };
}

async function cooperativeSortInPlace<T>(
    values: T[],
    compare: (left: T, right: T) => number,
    checkpoint: () => Promise<"aborted" | "deadline" | null>,
): Promise<"aborted" | "deadline" | null> {
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
