export type RetrievalCalibrationMode = "standard" | "relaxed";
export type RetrievalQueryMode = "strict_AND" | "clause_OR";
export type RetrievalBm25Weights = readonly [number, number, number, number];
export type RetrievalRrfSourceWeights = readonly [number, number];

export type RetrievalCalibrationEvidence =
    | "inherited_baseline"
    | "offline_provisional_winner"
    | "inherited_unvalidated";

export interface RetrievalSearchRuntimeParameters {
    profileId: string;
    profileVersion: number;
    variant: "baseline" | "candidate";
    mode: RetrievalCalibrationMode;
    provisional: true;
    evidence: RetrievalCalibrationEvidence;
    vectorRaw: number;
    lexicalRaw: number;
    fusionRaw: number;
    queryMode: RetrievalQueryMode;
    bm25Weights: RetrievalBm25Weights;
    rrf: Readonly<{
        k: number;
        sourceWeights: RetrievalRrfSourceWeights;
    }>;
}

const PROFILE_ID = "ec02-char-phrase-runtime-v1";
const PROFILE_VERSION = 1;

function searchParameters(input: Omit<RetrievalSearchRuntimeParameters, "profileId" | "profileVersion" | "provisional">): RetrievalSearchRuntimeParameters {
    return Object.freeze({
        profileId: PROFILE_ID,
        profileVersion: PROFILE_VERSION,
        provisional: true as const,
        ...input,
        bm25Weights: Object.freeze([...input.bm25Weights]) as RetrievalBm25Weights,
        rrf: Object.freeze({
            ...input.rrf,
            sourceWeights: Object.freeze([...input.rrf.sourceWeights]) as RetrievalRrfSourceWeights,
        }),
    });
}

const baselineStandard = searchParameters({
    variant: "baseline",
    mode: "standard",
    evidence: "inherited_baseline",
    vectorRaw: 8,
    lexicalRaw: 8,
    fusionRaw: 12,
    queryMode: "strict_AND",
    bm25Weights: [1, 1, 1, 1],
    rrf: { k: 60, sourceWeights: [1, 1] },
});

const baselineRelaxed = searchParameters({
    variant: "baseline",
    mode: "relaxed",
    evidence: "inherited_baseline",
    vectorRaw: 12,
    lexicalRaw: 12,
    fusionRaw: 18,
    queryMode: "strict_AND",
    bm25Weights: [1, 1, 1, 1],
    rrf: { k: 60, sourceWeights: [1, 1] },
});

const candidateStandard = searchParameters({
    variant: "candidate",
    mode: "standard",
    evidence: "offline_provisional_winner",
    vectorRaw: 8,
    lexicalRaw: 12,
    fusionRaw: 18,
    queryMode: "clause_OR",
    bm25Weights: [1.25, 1.25, 2, 0.25],
    rrf: { k: 30, sourceWeights: [1, 1] },
});

// No relaxed-mode grid or real-device evidence exists yet. Keep the inherited
// expansion unchanged and label it honestly instead of extending the standard
// offline winner by implication.
const candidateRelaxed = searchParameters({
    variant: "candidate",
    mode: "relaxed",
    evidence: "inherited_unvalidated",
    vectorRaw: 12,
    lexicalRaw: 12,
    fusionRaw: 18,
    queryMode: "strict_AND",
    bm25Weights: [1, 1, 1, 1],
    rrf: { k: 60, sourceWeights: [1, 1] },
});

/**
 * Single source of truth for the current EC-02 runtime candidate.
 *
 * This profile is intentionally provisional and default-off. Its standard
 * lexical settings reproduce the frozen offline winner; graph, deadline,
 * batching, and relaxed values remain inherited device-calibration inputs.
 */
export const RETRIEVAL_CALIBRATION_PROFILE = Object.freeze({
    id: PROFILE_ID,
    version: PROFILE_VERSION,
    lexicalProfileId: "char-phrase-v1",
    provisional: true as const,
    defaultEnabled: false as const,
    offlineWinnerId: "clause_OR/body_favor/compact/k30_equal",
    scoreThreshold: 0.01,
    baseline: Object.freeze({
        standard: baselineStandard,
        relaxed: baselineRelaxed,
    }),
    candidate: Object.freeze({
        standard: candidateStandard,
        relaxed: candidateRelaxed,
    }),
    graph: Object.freeze({
        evidence: "inherited_unvalidated" as const,
        budgetMs: 8_000,
        maxSnapshotNodes: 10_000,
        maxSnapshotEdges: 50_000,
        maxSnapshotBytes: 8 * 1024 * 1024,
        maxCanonicalNodes: 10_000,
        maxCanonicalEdges: 50_000,
        maxLiftedStates: 20_000,
        maxLegalTransitions: 100_000,
        maxLocalCandidatePaths: 512,
        maxProjectedSolverOperations: 15_000_000,
        maxProjectedBytes: 8 * 1024 * 1024,
        laneTopN: 12,
        probeTopN: 30,
        cosine: Object.freeze({ standard: 0.3, relaxed: 0.2 }),
        maxPathsPerBatch: 64,
        maxCandidatePaths: 512,
        maxChunksScanned: 6_000,
        cosineBlockSize: 128,
        cooperativeCheckpointEvery: 128,
    }),
    lexicalRuntime: Object.freeze({
        evidence: "inherited_unvalidated" as const,
        searchBudgetMs: 500,
        rebuildBatchSize: 128,
        maxRebuildBatchSize: 256,
        sqliteProgressOperationInterval: 1_000,
    }),
});

export function selectRetrievalSearchRuntimeParameters(
    candidateEnabled: boolean,
    mode: RetrievalCalibrationMode,
): RetrievalSearchRuntimeParameters {
    return candidateEnabled
        ? RETRIEVAL_CALIBRATION_PROFILE.candidate[mode]
        : RETRIEVAL_CALIBRATION_PROFILE.baseline[mode];
}

export function isValidRetrievalSearchRuntimeParameters(
    value: unknown,
): value is RetrievalSearchRuntimeParameters {
    if (!value || typeof value !== "object") return false;
    const input = value as Partial<RetrievalSearchRuntimeParameters>;
    if (!(input.profileId === RETRIEVAL_CALIBRATION_PROFILE.id
        && input.profileVersion === RETRIEVAL_CALIBRATION_PROFILE.version
        && (input.variant === "baseline" || input.variant === "candidate")
        && (input.mode === "standard" || input.mode === "relaxed")
        && input.provisional === true
        && (
            input.evidence === "inherited_baseline"
            || input.evidence === "offline_provisional_winner"
            || input.evidence === "inherited_unvalidated"
        )
        && Number.isInteger(input.vectorRaw) && input.vectorRaw! > 0 && input.vectorRaw! <= 96
        && Number.isInteger(input.lexicalRaw) && input.lexicalRaw! > 0 && input.lexicalRaw! <= 96
        && Number.isInteger(input.fusionRaw) && input.fusionRaw! > 0 && input.fusionRaw! <= 72
        && (input.queryMode === "strict_AND" || input.queryMode === "clause_OR")
        && isFiniteNonNegativeTuple(input.bm25Weights, 4)
        && Boolean(input.rrf)
        && Number.isFinite(input.rrf?.k) && input.rrf!.k >= 0
        && isFiniteNonNegativeTuple(input.rrf?.sourceWeights, 2))) return false;

    const expected = input.variant === "candidate"
        ? RETRIEVAL_CALIBRATION_PROFILE.candidate[input.mode!]
        : RETRIEVAL_CALIBRATION_PROFILE.baseline[input.mode!];
    return input.evidence === expected.evidence
        && input.vectorRaw === expected.vectorRaw
        && input.lexicalRaw === expected.lexicalRaw
        && input.fusionRaw === expected.fusionRaw
        && input.queryMode === expected.queryMode
        && tuplesEqual(input.bm25Weights!, expected.bm25Weights)
        && input.rrf!.k === expected.rrf.k
        && tuplesEqual(input.rrf!.sourceWeights, expected.rrf.sourceWeights);
}

function isFiniteNonNegativeTuple(value: unknown, length: number): boolean {
    return Array.isArray(value)
        && value.length === length
        && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0);
}

function tuplesEqual(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
