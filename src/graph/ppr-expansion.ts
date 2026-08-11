import {
    getPprStateKey,
    type BoundaryStateGraph,
    type GraphBoundarySnapshot,
    type PPRSolveResult,
} from "./personalized-pagerank";
import { waitForInterruptibleMacrotask } from "./interruptible-macrotask";
import { RETRIEVAL_CALIBRATION_PROFILE } from "../vss/retrieval-calibration";

export type GraphLane = "local" | "deep_breadth" | "convergence";

export interface PPRSeedEvidence {
    seedPath: string;
    scores: ReadonlyMap<string, number>;
    errorBound: number;
}

export interface GraphLaneWorksetEntry {
    path: string;
    memberships: ReadonlySet<GraphLane>;
    breadthScore?: number;
    convergenceScore?: number;
}

export interface GraphLaneWorksets {
    localPaths: readonly string[];
    deepBreadth: readonly GraphLaneWorksetEntry[];
    convergence: readonly GraphLaneWorksetEntry[];
    union: readonly GraphLaneWorksetEntry[];
    breadthErrorBound: number;
    convergenceErrorBound: number;
}

export interface GraphLaneWorksetLimits {
    deepBreadthTopN: number;
    convergenceTopN: number;
}

export interface RankedGraphLaneLimits {
    localTopN: number;
}

export interface RankedGraphPath extends GraphLaneWorksetEntry {
    cosine: number;
}

export interface CompleteLocalCollectionLimits {
    maxLocalCandidatePaths: number;
    absoluteDeadlineMs: number;
    checkpointEvery?: number;
}

export interface CompleteLocalCollectionOptions {
    signal?: AbortSignal;
    now?: () => number;
    yieldMacrotask?: () => Promise<void>;
}

export type CompleteLocalCollectionResult =
    | { ok: true; paths: ReadonlySet<string>; scannedEdges: number }
    | {
        ok: false;
        reason: "aborted" | "deadline" | "local_budget" | "invalid_graph";
        scannedEdges: number;
        localCandidatePaths: number;
    };

export interface GraphAllocationOptions {
    cosineThreshold: number;
    maxGraphCandidates?: number;
    /** Host-current exact repeats; removed before lane nomination and graph-6 fill. */
    excludedCandidatePaths?: ReadonlySet<string>;
}

export const PROVISIONAL_GRAPH_LANE_TOP_N = RETRIEVAL_CALIBRATION_PROFILE.graph.laneTopN;

/**
 * Collect the complete undirected legal one-hop Local lane cooperatively.
 * Overflow/failure returns no prefix, allowing callers to drop Local while an
 * independently safe PPR solve continues.
 */
export async function collectCompleteLocalCandidatePaths(
    snapshot: GraphBoundarySnapshot,
    seedPaths: readonly string[],
    directPaths: ReadonlySet<string>,
    limits: CompleteLocalCollectionLimits,
    options: CompleteLocalCollectionOptions = {},
): Promise<CompleteLocalCollectionResult> {
    const now = options.now ?? Date.now;
    const checkpointEvery = Math.max(1, Math.floor(
        limits.checkpointEvery ?? RETRIEVAL_CALIBRATION_PROFILE.graph.cooperativeCheckpointEvery,
    ));
    let operations = 0;
    let scannedEdges = 0;
    const local = new Set<string>();
    const fail = (reason: Exclude<CompleteLocalCollectionResult, { ok: true }>["reason"]): CompleteLocalCollectionResult => ({
        ok: false,
        reason,
        scannedEdges,
        localCandidatePaths: local.size,
    });
    const currentFailure = (): CompleteLocalCollectionResult | null => {
        if (options.signal?.aborted) return fail("aborted");
        if (now() >= limits.absoluteDeadlineMs) return fail("deadline");
        if (local.size > limits.maxLocalCandidatePaths) return fail("local_budget");
        return null;
    };
    const checkpoint = async (): Promise<CompleteLocalCollectionResult | null> => {
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
    if (
        !Number.isInteger(limits.maxLocalCandidatePaths)
        || limits.maxLocalCandidatePaths < 0
        || !Number.isFinite(limits.absoluteDeadlineMs)
        || snapshot.pathClasses.size !== snapshot.snapshotNodes
        || !Number.isInteger(snapshot.snapshotEdges)
        || snapshot.snapshotEdges < 0
    ) return fail("invalid_graph");
    const seeds = new Set(selectDistinctPprSeeds(seedPaths));
    if (seeds.size === 0 || [...seeds].some((path) => snapshot.pathClasses.get(path) !== "allowed_markdown")) {
        return fail("invalid_graph");
    }

    for (const [source, targets] of snapshot.resolvedLinks) {
        if (!snapshot.pathClasses.has(source)) return fail("invalid_graph");
        const sourceCheckpoint = await checkpoint();
        if (sourceCheckpoint) return sourceCheckpoint;
        for (const target of targets) {
            scannedEdges += 1;
            if (!snapshot.pathClasses.has(target)) return fail("invalid_graph");
            if (
                seeds.has(source)
                && snapshot.pathClasses.get(target) === "allowed_markdown"
                && !directPaths.has(target)
            ) local.add(target);
            if (
                seeds.has(target)
                && snapshot.pathClasses.get(source) === "allowed_markdown"
                && !directPaths.has(source)
            ) local.add(source);
            const edgeCheckpoint = await checkpoint();
            if (edgeCheckpoint) return edgeCheckpoint;
        }
    }
    if (scannedEdges !== snapshot.snapshotEdges) return fail("invalid_graph");
    return { ok: true, paths: local, scannedEdges };
}

export function selectDistinctPprSeeds(paths: readonly string[], maxSeeds = 3): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
        if (!path || seen.has(path)) continue;
        seen.add(path);
        result.push(path);
        if (result.length >= maxSeeds) break;
    }
    return result;
}

export function shouldActivatePpr(
    graph: BoundaryStateGraph,
    seedPaths: readonly string[],
    directPaths: ReadonlySet<string>,
): boolean {
    const local = graph.localCandidatePaths;
    for (const path of graph.allowedStateKeysByPath.keys()) {
        if (!directPaths.has(path) && !local.has(path)) return true;
    }
    if (seedPaths.length < 2) return false;

    const support = new Map<string, number>();
    for (const seed of seedPaths) {
        const seedKey = getPprStateKey(seed, false);
        const perSeed = new Set<string>();
        for (const transition of graph.transitions.get(seedKey) ?? []) {
            const state = graph.states.get(transition.targetKey);
            if (state?.nodeClass !== "allowed" || directPaths.has(state.path)) continue;
            perSeed.add(state.path);
        }
        for (const path of perSeed) support.set(path, (support.get(path) ?? 0) + 1);
    }
    return [...support.values()].some((count) => count >= 2);
}

export function collectSuccessfulSeedEvidence(
    seeds: readonly string[],
    results: readonly PPRSolveResult[],
): PPRSeedEvidence[] | null {
    if (seeds.length !== results.length || seeds.length === 0) return null;
    const evidence: PPRSeedEvidence[] = [];
    for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (!result?.converged) return null;
        evidence.push({ seedPath: seeds[index], scores: result.scores, errorBound: result.errorBound });
    }
    return evidence;
}

/**
 * `semanticLocalPaths` is the complete one-hop set that Deep must not relabel.
 * `admittedLocalPaths` is the independently bounded subset allowed into Local;
 * Convergence may still overlap the semantic set when Local fails closed.
 */
export function buildGraphLaneWorksets(
    seedEvidence: readonly PPRSeedEvidence[],
    directPaths: ReadonlySet<string>,
    semanticLocalPaths: ReadonlySet<string>,
    limits: GraphLaneWorksetLimits,
    excludedCandidatePaths: ReadonlySet<string> = new Set(),
    admittedLocalPaths: ReadonlySet<string> = semanticLocalPaths,
): GraphLaneWorksets {
    const seedCount = seedEvidence.length;
    const breadthErrorBound = seedCount === 0
        ? Number.POSITIVE_INFINITY
        : seedEvidence.reduce((sum, seed) => sum + seed.errorBound, 0) / seedCount;
    const convergenceErrorBound = seedCount === 0
        ? Number.POSITIVE_INFINITY
        : Math.max(...seedEvidence.map((seed) => seed.errorBound));
    const candidatePaths = new Set<string>();
    for (const seed of seedEvidence) {
        for (const path of seed.scores.keys()) candidatePaths.add(path);
    }

    const deep: GraphLaneWorksetEntry[] = [];
    const convergence: GraphLaneWorksetEntry[] = [];
    for (const path of candidatePaths) {
        if (directPaths.has(path) || excludedCandidatePaths.has(path)) continue;
        const scores = seedEvidence.map((seed) => seed.scores.get(path) ?? 0);
        const breadthScore = seedCount > 0
            ? scores.reduce((sum, score) => sum + score, 0) / seedCount
            : 0;
        if (!semanticLocalPaths.has(path) && breadthScore > breadthErrorBound) {
            deep.push({
                path,
                memberships: new Set<GraphLane>(["deep_breadth"]),
                breadthScore,
            });
        }
        const convergenceScore = convergenceOrderStatistic(scores);
        if (seedCount >= 2 && convergenceScore > convergenceErrorBound) {
            convergence.push({
                path,
                memberships: new Set<GraphLane>(["convergence"]),
                convergenceScore,
            });
        }
    }

    deep.sort((left, right) => compareScorePath(right.breadthScore ?? 0, left.breadthScore ?? 0, left.path, right.path));
    convergence.sort((left, right) => compareScorePath(
        right.convergenceScore ?? 0,
        left.convergenceScore ?? 0,
        left.path,
        right.path,
    ));
    const boundedDeep = deep.slice(0, Math.max(0, Math.floor(limits.deepBreadthTopN)));
    const boundedConvergence = convergence.slice(0, Math.max(0, Math.floor(limits.convergenceTopN)));
    const union = new Map<string, MutableGraphLaneWorksetEntry>();
    for (const path of [...admittedLocalPaths].sort(comparePath)) {
        if (directPaths.has(path) || excludedCandidatePaths.has(path)) continue;
        mergeLaneEntry(union, { path, memberships: new Set<GraphLane>(["local"]) });
    }
    for (const entry of [...boundedDeep, ...boundedConvergence]) mergeLaneEntry(union, entry);

    return {
        localPaths: [...admittedLocalPaths]
            .filter((path) => !directPaths.has(path) && !excludedCandidatePaths.has(path))
            .sort(comparePath),
        deepBreadth: boundedDeep,
        convergence: boundedConvergence,
        union: [...union.values()].map(freezeEntry),
        breadthErrorBound,
        convergenceErrorBound,
    };
}

export function allocateGraphCandidates(
    entries: readonly RankedGraphPath[],
    directPaths: ReadonlySet<string>,
    options: GraphAllocationOptions,
): RankedGraphPath[] {
    const capacity = Math.max(0, Math.min(6, Math.floor(options.maxGraphCandidates ?? 6)));
    const eligibleByPath = new Map<string, RankedGraphPath>();
    for (const entry of entries) {
        if (
            directPaths.has(entry.path)
            || options.excludedCandidatePaths?.has(entry.path)
            || !Number.isFinite(entry.cosine)
            || entry.cosine < options.cosineThreshold
        ) continue;
        const existing = eligibleByPath.get(entry.path);
        if (!existing) {
            eligibleByPath.set(entry.path, cloneRankedEntry(entry));
            continue;
        }
        const memberships = new Set([...existing.memberships, ...entry.memberships]);
        eligibleByPath.set(entry.path, {
            ...existing,
            ...entry,
            cosine: Math.max(existing.cosine, entry.cosine),
            breadthScore: maxDefined(existing.breadthScore, entry.breadthScore),
            convergenceScore: maxDefined(existing.convergenceScore, entry.convergenceScore),
            memberships,
        });
    }
    const eligible = [...eligibleByPath.values()];
    const selected = new Map<string, RankedGraphPath>();
    const nominate = (lane: GraphLane, compare: (left: RankedGraphPath, right: RankedGraphPath) => number) => {
        const candidate = eligible.filter((entry) => entry.memberships.has(lane)).sort(compare)[0];
        if (candidate && selected.size < capacity) selected.set(candidate.path, candidate);
    };
    nominate("local", compareCosinePath);
    nominate("deep_breadth", compareBreadthCosinePath);
    nominate("convergence", compareConvergenceCosinePath);

    for (const entry of eligible.sort(compareCosinePath)) {
        if (selected.size >= capacity) break;
        selected.set(entry.path, entry);
    }
    return [...selected.values()].sort(compareCosinePath);
}

/** Apply the provisional Local Top-N only after the complete Local set was cosine-scored. */
export function joinRankedGraphWorksets(
    worksets: GraphLaneWorksets,
    cosineByPath: ReadonlyMap<string, number>,
    limits: RankedGraphLaneLimits = { localTopN: PROVISIONAL_GRAPH_LANE_TOP_N },
    excludedCandidatePaths: ReadonlySet<string> = new Set(),
): RankedGraphPath[] {
    const selectedByLane = new Map<GraphLane, Set<string>>();
    const local = worksets.localPaths
        .filter((path) => !excludedCandidatePaths.has(path))
        .flatMap((path): RankedGraphPath[] => {
            const cosine = cosineByPath.get(path);
            return Number.isFinite(cosine) ? [{ path, memberships: new Set(["local"]), cosine: cosine! }] : [];
        })
        .sort(compareCosinePath)
        .slice(0, Math.max(0, Math.floor(limits.localTopN)));
    selectedByLane.set("local", new Set(local.map((entry) => entry.path)));
    selectedByLane.set("deep_breadth", new Set(worksets.deepBreadth.map((entry) => entry.path)));
    selectedByLane.set("convergence", new Set(worksets.convergence.map((entry) => entry.path)));

    const ranked: RankedGraphPath[] = [];
    for (const entry of worksets.union) {
        if (excludedCandidatePaths.has(entry.path)) continue;
        const cosine = cosineByPath.get(entry.path);
        if (!Number.isFinite(cosine)) continue;
        const memberships = new Set(
            [...entry.memberships].filter((lane) => selectedByLane.get(lane)?.has(entry.path)),
        );
        if (memberships.size === 0) continue;
        ranked.push({ ...entry, memberships, cosine: cosine! });
    }
    return ranked.sort(compareCosinePath);
}

function convergenceOrderStatistic(scores: readonly number[]): number {
    if (scores.length < 2) return 0;
    const sorted = [...scores].sort((left, right) => right - left);
    return scores.length === 2 ? Math.min(scores[0], scores[1]) : sorted[1] ?? 0;
}

interface MutableGraphLaneWorksetEntry {
    path: string;
    memberships: Set<GraphLane>;
    breadthScore?: number;
    convergenceScore?: number;
}

function mergeLaneEntry(target: Map<string, MutableGraphLaneWorksetEntry>, input: GraphLaneWorksetEntry): void {
    const existing = target.get(input.path);
    if (!existing) {
        target.set(input.path, {
            path: input.path,
            memberships: new Set(input.memberships),
            breadthScore: input.breadthScore,
            convergenceScore: input.convergenceScore,
        });
        return;
    }
    for (const lane of input.memberships) existing.memberships.add(lane);
    existing.breadthScore = maxDefined(existing.breadthScore, input.breadthScore);
    existing.convergenceScore = maxDefined(existing.convergenceScore, input.convergenceScore);
}

function freezeEntry(entry: MutableGraphLaneWorksetEntry): GraphLaneWorksetEntry {
    return { ...entry, memberships: new Set(entry.memberships) };
}

function cloneRankedEntry(entry: RankedGraphPath): RankedGraphPath {
    return { ...entry, memberships: new Set(entry.memberships) };
}

function maxDefined(left?: number, right?: number): number | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.max(left, right);
}

function compareCosinePath(left: RankedGraphPath, right: RankedGraphPath): number {
    return right.cosine - left.cosine || comparePath(left.path, right.path);
}

function compareBreadthCosinePath(left: RankedGraphPath, right: RankedGraphPath): number {
    return (right.breadthScore ?? 0) - (left.breadthScore ?? 0)
        || compareCosinePath(left, right);
}

function compareConvergenceCosinePath(left: RankedGraphPath, right: RankedGraphPath): number {
    return (right.convergenceScore ?? 0) - (left.convergenceScore ?? 0)
        || compareCosinePath(left, right);
}

function compareScorePath(
    rightScore: number,
    leftScore: number,
    leftPath: string,
    rightPath: string,
): number {
    return rightScore - leftScore || comparePath(leftPath, rightPath);
}

function comparePath(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
