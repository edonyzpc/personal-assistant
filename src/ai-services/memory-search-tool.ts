import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";

import { rewriteQueryForSearch, REWRITE_SYSTEM_PROMPT, REWRITE_TIMEOUT_MS, type QueryTemporalIntent, type RewrittenQuery } from "./query-rewriter";
import { clearPlatformTimeout, setPlatformTimeout } from "../platform-dom";
import type { AIUtils, ProviderRequestOptions } from "./ai-utils";
import type { AiServiceHost, LatestMemorySourceMaterial } from "./AiServiceHost";
import { createAbortError, throwIfAborted } from "./chat-utils";
import { truncate } from "./chat-tool-execution-helpers";
import { normalizeVaultPath } from "../pa/helpers";
import { createHeadingAwareMarkdownChunks } from "../vss/markdown-chunker";
import { buildGraphBoundarySnapshot } from "../graph/graph-boundary-snapshot";
import { runInterruptibleParallelGroup } from "../graph/interruptible-macrotask";
import {
    buildBoundaryStateGraph,
    solvePersonalizedPageRank,
    type GraphWorkLimits,
} from "../graph/personalized-pagerank";
import {
    allocateGraphCandidates,
    buildGraphLaneWorksets,
    collectCompleteLocalCandidatePaths,
    collectSuccessfulSeedEvidence,
    joinRankedGraphWorksets,
    selectDistinctPprSeeds,
    shouldActivatePpr,
} from "../graph/ppr-expansion";
import type {
    PathEvidenceGenerationRef,
    PathEvidenceGenerationStatus,
    RankedPathChunks,
    RankedPathRequestControl,
} from "../vss/types";
import type {
    MemoryCandidate,
    MemoryCandidateAnchor,
    MemoryFrozenLexicalPlan,
    MemoryRejectedEvidence,
    MemorySearchDocument,
    MemorySearchRecoverySeed,
    MemorySearchResult,
    MemoryTemporalFilter,
    MemoryTemporalProjectionAudit,
    RerankFailOpenReason,
    RerankOutcome,
} from "./chat-types";
import { RETRIEVAL_CALIBRATION_PROFILE } from "../vss/retrieval-calibration";
import type {
    RetrievalDiagnosticEventInput,
    RetrievalDiagnosticRecorder,
    RetrievalDiagnosticSurface,
} from "./retrieval-diagnostics";
import {
    isB125RetrievalOptimizationPlatformSupported,
    resolveB125RetrievalOptimizationFlags,
} from "../retrieval-optimization-platform-policy";

export interface RawSearchResult {
    score?: unknown;
    doc?: {
        pageContent?: unknown;
        metadata?: Record<string, unknown>;
    };
}

interface MemorySearchDiagnosticState {
    temporalFilterApplied?: 0 | 1;
    temporalViolationCount?: number;
}

const MAX_MEMORY_DOCUMENTS = 8;
const MAX_MEMORY_CHARS = 4000;
const MAX_MEMORY_DIRECT_CANDIDATES = 12;
const MAX_MEMORY_GRAPH_CANDIDATES = 6;
const MAX_MEMORY_RERANK_CANDIDATES = MAX_MEMORY_DIRECT_CANDIDATES + MAX_MEMORY_GRAPH_CANDIDATES;
const MAX_MEMORY_CANDIDATE_CHUNKS = 3;
const MAX_MEMORY_CANDIDATE_EXCERPT_CHARS = 1000;
const MIN_MEMORY_SCORE: number = RETRIEVAL_CALIBRATION_PROFILE.scoreThreshold;

const RERANK_TIMEOUT_MS = 30_000;
// Leave the same projection reserve used by Recovery before its attempt deadline.
const RERANK_PROJECTION_MARGIN_MS = 500;

// EC-02 safety envelopes calibrated before shipping-default activation.
// Current enablement comes only from the versioned rollout policy; these
// provisional evidence labels do not independently enable or disable graph PPR.
const PROVISIONAL_EC02_GRAPH = RETRIEVAL_CALIBRATION_PROFILE.graph;
const RELAXED_DIRECT_RESULT_LIMIT = RETRIEVAL_CALIBRATION_PROFILE.candidate.relaxed.fusionRaw;
// Absolute diagnostics safety envelope only. This is not a calibrated maximum
// Worker batch duration and must not be reported as one.
const GRAPH_QUEUE_RELEASE_PROBE_TIMEOUT_MS = PROVISIONAL_EC02_GRAPH.budgetMs;

let graphRequestSequence = 0;

const RERANK_SYSTEM_PROMPT = [
    "You are a strict relevance filter for a personal knowledge base.",
    "Task: Rank candidates that ACTUALLY help answer the query, then judge whether the ranked evidence answers the exact request completely. Be conservative.",
    "Rules:",
    "- Include a candidate ONLY if its content directly addresses the query topic",
    "- Omit candidates that merely share superficial keywords or are topically unrelated",
    "- Judge answer sufficiency from the ranked evidence as a whole, not from topical relevance alone",
    "- verdict must be relevant, partially_relevant, or none_relevant",
    "- relevant requires a non-empty ranking that can answer the exact request without guessing or filling a missing fact; set needsMoreEvidence=false",
    "- partially_relevant requires a non-empty ranking that directly helps but leaves a requested fact or conclusion unresolved; set needsMoreEvidence=true when additional evidence is required",
    "- When the query asks for an answer, conclusion, or root cause itself and the ranked evidence as a whole still leaves it unknown, unconfirmed, missing, or incomplete, use partially_relevant with needsMoreEvidence=true",
    "- Do not mark the whole set partial merely because one candidate describes a past unknown state when other ranked evidence answers the exact request",
    "- none_relevant requires an empty ranking and needsMoreEvidence=true",
    "- Ranking indices must be unique 0-based integers from the supplied candidates",
    "- Order included candidates by relevance (most relevant first)",
    'Return ONLY one valid JSON object with exactly the keys "verdict", "ranking", and "needsMoreEvidence"; do not add prose or code fences.',
].join("\n");

export interface SelectedRerankModel {
    kind: "policy" | "chat";
    modelName: string;
}

interface CoherentMaterializedCandidateSet {
    candidates: MemoryCandidate[];
    sourceEpoch: string;
    boundaryEpoch: string;
    generations: ReadonlyMap<string, string>;
    temporalViolationCount: number;
}

interface PreparedMemoryReranker {
    invoke(query: string, candidates: MemoryCandidate[]): Promise<RerankOutcome>;
    dispose(): void;
}

function combineAbortSignals(signals: readonly AbortSignal[]): {
    signal: AbortSignal;
    dispose(): void;
} {
    const uniqueSignals = [...new Set(signals)];
    if (uniqueSignals.length === 1) {
        return { signal: uniqueSignals[0], dispose: () => undefined };
    }

    const controller = new AbortController();
    let listening = false;
    const cleanup = () => {
        if (!listening) return;
        listening = false;
        for (const signal of uniqueSignals) signal.removeEventListener("abort", abort);
    };
    const abort = () => {
        cleanup();
        controller.abort();
    };

    if (uniqueSignals.some((signal) => signal.aborted)) {
        controller.abort();
    } else {
        listening = true;
        for (const signal of uniqueSignals) signal.addEventListener("abort", abort, { once: true });
        if (uniqueSignals.some((signal) => signal.aborted)) abort();
    }

    return { signal: controller.signal, dispose: cleanup };
}

interface ActiveGraphRankRequest {
    readonly key: string;
    readonly requestId: string;
    readonly runEpoch: string;
    readonly controller: AbortController;
    readonly parentSignal?: AbortSignal;
    onParentAbort?: () => void;
    unsubscribeSettings?: () => void;
    invalidated: boolean;
}

type RejectedEvidenceBuildResult =
    | { ok: true; evidence: MemoryRejectedEvidence[] }
    | { ok: false };

const MEMORY_SEARCH_INVOCATION_BRAND: unique symbol = Symbol("memory-search-invocation");

export type MemorySearchInvocationOptions =
    | {
        readonly [MEMORY_SEARCH_INVOCATION_BRAND]: true;
        readonly mode: "standard";
        readonly temporalIntent: QueryTemporalIntent;
        readonly captureRecoverySeed: boolean;
        readonly invocationOrdinal?: number;
        readonly runEpoch?: string;
        readonly absoluteDeadlineMs?: number;
        readonly providerRequestScope?: ProviderRequestOptions["providerRequestScope"];
        /** Run-owned lifetime for detached DEC-028 preparation; never an attempt deadline signal. */
        readonly memoryPreparationOwnerSignal?: AbortSignal;
    }
    | {
        readonly [MEMORY_SEARCH_INVOCATION_BRAND]: true;
        readonly mode: "relaxed";
        readonly seed: MemorySearchRecoverySeed;
        readonly invocationOrdinal?: number;
        readonly runEpoch?: string;
        readonly absoluteDeadlineMs?: number;
        readonly providerRequestScope?: ProviderRequestOptions["providerRequestScope"];
        /** Run-owned lifetime for detached DEC-028 preparation; never an attempt deadline signal. */
        readonly memoryPreparationOwnerSignal?: AbortSignal;
    };

const MEMORY_SEARCH_INVOCATIONS = new WeakMap<AbortSignal, MemorySearchInvocationOptions>();
const MEMORY_SEARCH_TEMPORAL_FILTER_CAPTURES = new WeakMap<
    MemorySearchInvocationOptions,
    MemorySearchTemporalFilterCapture
>();

/** Host-only output sink; never projected, persisted, logged, or replayed. */
export interface MemorySearchTemporalFilterCapture {
    temporalFilter?: MemoryTemporalFilter | null;
}

export function createStandardMemorySearchInvocation(options: {
    temporalIntent: QueryTemporalIntent;
    captureRecoverySeed: boolean;
    invocationOrdinal?: number;
    temporalFilterCapture?: MemorySearchTemporalFilterCapture;
    runEpoch?: string;
    absoluteDeadlineMs?: number;
    providerRequestScope?: ProviderRequestOptions["providerRequestScope"];
    memoryPreparationOwnerSignal?: AbortSignal;
}): MemorySearchInvocationOptions {
    const invocation: MemorySearchInvocationOptions = Object.freeze({
        [MEMORY_SEARCH_INVOCATION_BRAND]: true as const,
        mode: "standard" as const,
        temporalIntent: options.temporalIntent,
        captureRecoverySeed: options.captureRecoverySeed,
        ...(isValidInvocationOrdinal(options.invocationOrdinal)
            ? { invocationOrdinal: options.invocationOrdinal }
            : {}),
        ...(options.runEpoch ? { runEpoch: options.runEpoch } : {}),
        ...(Number.isFinite(options.absoluteDeadlineMs)
            ? { absoluteDeadlineMs: options.absoluteDeadlineMs }
            : {}),
        ...(options.providerRequestScope ? { providerRequestScope: options.providerRequestScope } : {}),
        ...(options.memoryPreparationOwnerSignal
            ? { memoryPreparationOwnerSignal: options.memoryPreparationOwnerSignal }
            : {}),
    });
    if (options.temporalFilterCapture) {
        MEMORY_SEARCH_TEMPORAL_FILTER_CAPTURES.set(invocation, options.temporalFilterCapture);
    }
    return invocation;
}

export function createRelaxedMemorySearchInvocation(
    seed: MemorySearchRecoverySeed,
    control: {
        invocationOrdinal?: number;
        runEpoch?: string;
        absoluteDeadlineMs?: number;
        providerRequestScope?: ProviderRequestOptions["providerRequestScope"];
        memoryPreparationOwnerSignal?: AbortSignal;
    } = {},
): MemorySearchInvocationOptions {
    return Object.freeze({
        [MEMORY_SEARCH_INVOCATION_BRAND]: true as const,
        mode: "relaxed" as const,
        seed: cloneRecoverySeed(seed),
        ...(isValidInvocationOrdinal(control.invocationOrdinal)
            ? { invocationOrdinal: control.invocationOrdinal }
            : {}),
        ...(control.runEpoch ? { runEpoch: control.runEpoch } : {}),
        ...(Number.isFinite(control.absoluteDeadlineMs)
            ? { absoluteDeadlineMs: control.absoluteDeadlineMs }
            : {}),
        ...(control.providerRequestScope ? { providerRequestScope: control.providerRequestScope } : {}),
        ...(control.memoryPreparationOwnerSignal
            ? { memoryPreparationOwnerSignal: control.memoryPreparationOwnerSignal }
            : {}),
    });
}

/** Host-only dynamic invocation scope; never appears in the model tool schema. */
export async function runWithMemorySearchInvocation<T>(
    invocation: MemorySearchInvocationOptions,
    signal: AbortSignal,
    task: () => Promise<T>,
): Promise<T> {
    throwIfAborted(signal);
    if (MEMORY_SEARCH_INVOCATIONS.has(signal)) {
        throw new Error("A Memory search invocation is already bound to this signal.");
    }
    const clear = () => MEMORY_SEARCH_INVOCATIONS.delete(signal);
    MEMORY_SEARCH_INVOCATIONS.set(signal, invocation);
    signal.addEventListener("abort", clear, { once: true });
    try {
        return await task();
    } finally {
        signal.removeEventListener("abort", clear);
        clear();
    }
}

export function selectRerankModel(settings: {
    policyModelName?: string;
    chatModelName?: string;
}): SelectedRerankModel | undefined {
    const policy = settings.policyModelName?.trim();
    if (policy) return { kind: "policy", modelName: policy };
    const chat = settings.chatModelName?.trim();
    if (chat) return { kind: "chat", modelName: chat };
    return undefined;
}

export class MemorySearchTool {
    private readonly host: AiServiceHost;
    private readonly aiUtils: AIUtils;
    private readonly diagnosticSurface: RetrievalDiagnosticSurface;
    private readonly activeGraphRankRequests = new Map<string, ActiveGraphRankRequest>();
    private disposed = false;

    constructor(
        host: AiServiceHost,
        aiUtils: AIUtils,
        diagnosticSurface: RetrievalDiagnosticSurface = "chat",
    ) {
        this.host = host;
        this.aiUtils = aiUtils;
        this.diagnosticSurface = diagnosticSurface;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const request of [...this.activeGraphRankRequests.values()]) {
            this.invalidateGraphRankRequest(request);
            this.finishGraphRankRequest(request);
        }
    }

    async search(query: string, signal?: AbortSignal, onBeforeVssSearch?: () => void): Promise<MemorySearchResult> {
        throwIfAborted(signal);
        const invocation = signal ? MEMORY_SEARCH_INVOCATIONS.get(signal) : undefined;
        if (invocation?.mode === "relaxed") {
            if (invocation.seed.query !== query) {
                return createOperationalUnavailableResult(query, "current_source_unavailable");
            }
            onBeforeVssSearch?.();
            return this.searchVss(query, signal, invocation);
        }
        const decision = await this.host.memorySearch.ensureReadyForChat(
            query,
            signal,
            invocation?.memoryPreparationOwnerSignal ?? signal,
        );
        throwIfAborted(signal);

        if (decision.decision === "cancel") {
            throw createAbortError();
        }

        if (decision.decision === "answer-now") {
            return {
                usedMemory: false,
                query,
                documents: [],
                sources: [],
                skipReason: decision.message ?? "Memory was not used for this answer.",
                hasAnswerableContent: false,
                needsSnippetFollowup: false,
                memoryEvidenceState: "unavailable",
                rerankVerdict: "none_relevant",
                needsMoreEvidence: false,
                operationalReason: "memory_not_used",
            };
        }

        onBeforeVssSearch?.();
        return this.searchVss(query, signal, invocation);
    }

    /** Revalidates Host-only source handles immediately before a later provider request. */
    async revalidateForProvider(
        result: MemorySearchResult,
        signal?: AbortSignal,
        temporalFilter: MemoryTemporalFilter | null = null,
        temporalAudit?: MemoryTemporalProjectionAudit,
    ): Promise<MemorySearchResult> {
        throwIfAborted(signal);
        if (temporalAudit) {
            temporalAudit.temporalFilterApplied = temporalFilter ? 1 : 0;
            temporalAudit.temporalViolationCount = 0;
        }
        const candidates = result.candidates ?? [];
        if (result.documents.length === 0) return result;
        if (candidates.length === 0) {
            return createOperationalUnavailableResult(
                result.query,
                "final_source_changed",
                result.rerankOutcome,
            );
        }

        const sealed = await this.materializeCoherentCandidateSet(
            candidates,
            signal,
            true,
            temporalFilter,
        );
        if (temporalAudit && sealed) {
            temporalAudit.temporalViolationCount = sealed.temporalViolationCount;
        }
        if (!sealed || sealed.candidates.length === 0) {
            return createOperationalUnavailableResult(
                result.query,
                "final_source_changed",
                result.rerankOutcome,
            );
        }

        const documents = allocateMemoryDocumentsTwoPass(sealed.candidates, MAX_MEMORY_DOCUMENTS);
        if (documents.length === 0) {
            return createOperationalUnavailableResult(
                result.query,
                "final_source_changed",
                result.rerankOutcome,
            );
        }
        return {
            ...result,
            usedMemory: true,
            documents,
            sources: sourcesFromDocuments(documents),
            candidates: sealed.candidates,
            hasAnswerableContent: true,
            memoryEvidenceState: result.memoryEvidenceState === "partial" ? "partial" : "evidence",
        };
    }

    private async searchVss(
        query: string,
        signal?: AbortSignal,
        invocation?: MemorySearchInvocationOptions,
    ): Promise<MemorySearchResult> {
        const unboundRecord = this.host.createRetrievalDiagnosticRecorder
            ? this.host.createRetrievalDiagnosticRecorder(this.diagnosticSurface)
            : this.host.recordRetrievalDiagnostic
                ? (event: RetrievalDiagnosticEventInput) => (
                    this.host.recordRetrievalDiagnostic!(this.diagnosticSurface, event)
                )
                : undefined;
        const record = unboundRecord && invocation
            ? (event: RetrievalDiagnosticEventInput) => unboundRecord({
                ...event,
                ...(invocation.runEpoch ? { runId: invocation.runEpoch } : {}),
                ...(isValidInvocationOrdinal(invocation.invocationOrdinal)
                    ? { invocationOrdinal: invocation.invocationOrdinal }
                    : {}),
            })
            : unboundRecord;
        if (!record) return this.searchVssImpl(query, signal, invocation);
        const startedAt = Date.now();
        const diagnosticState: MemorySearchDiagnosticState = {};
        safeRecordDiagnostic(record, {
            phase: "memory_search",
            outcome: "started",
            metrics: remainingDeadlineMetric(invocation?.absoluteDeadlineMs),
        });
        try {
            const result = await this.searchVssImpl(
                query,
                signal,
                invocation,
                record,
                diagnosticState,
            );
            const unavailableReason = memorySearchUnavailableDiagnosticReason(result);
            const documentCount = result.documents.length;
            const semanticNone = !unavailableReason
                && documentCount === 0
                && result.memoryEvidenceState === "none";
            safeRecordDiagnostic(record, {
                phase: "memory_search",
                outcome: unavailableReason ? "failed" : "completed",
                ...(unavailableReason
                    ? { reason: unavailableReason }
                    : semanticNone ? { reason: "semantic_none" } : {}),
                metrics: {
                    durationMs: Date.now() - startedAt,
                    candidateCount: result.candidates?.length ?? 0,
                    ...(!unavailableReason && (documentCount > 0 || semanticNone)
                        ? { documentCount }
                        : {}),
                    ...temporalDiagnosticMetrics(diagnosticState),
                },
            });
            return result;
        } catch (error) {
            safeRecordDiagnostic(record, {
                phase: "memory_search",
                outcome: signal?.aborted ? "aborted" : isDeadlineError(error) ? "deadline" : "failed",
                reason: diagnosticReason(error),
                metrics: {
                    durationMs: Date.now() - startedAt,
                    ...temporalDiagnosticMetrics(diagnosticState),
                },
            });
            throw error;
        }
    }

    private async searchVssImpl(
        query: string,
        signal?: AbortSignal,
        invocation?: MemorySearchInvocationOptions,
        record?: RetrievalDiagnosticRecorder,
        diagnosticState?: MemorySearchDiagnosticState,
    ): Promise<MemorySearchResult> {
        throwIfAborted(signal);

        const policyModelName = this.host.settings.policyModelName.trim();
        const selectedRerankModel = selectRerankModel(this.host.settings);

        // Standard rewrite (when configured) and embedding still run concurrently.
        // A relaxed attempt reuses the immutable first-attempt plan and embedding;
        // it never invokes either provider a second time.
        const lexicalPlanPromise: Promise<MemoryFrozenLexicalPlan> = invocation?.mode === "relaxed"
            ? Promise.resolve(cloneFrozenLexicalPlan(invocation.seed.lexicalPlan))
            : (policyModelName
                ? this.rewriteQueryWithTimeout(query, policyModelName, signal, invocation)
                : Promise.resolve<RewrittenQuery>({ keywords: null, temporal: "none" }))
                .then((result) => freezeLexicalPlan(
                    result,
                    invocation?.mode === "standard" ? invocation.temporalIntent : "none",
                ));
        const ftsQueryOverridePromise = lexicalPlanPromise.then((plan) => plan.ftsQueryOverride);
        const temporalFilterPromise = lexicalPlanPromise.then((plan) => plan.temporalFilter);
        const queryEmbeddingOut: {
            value?: number[];
            profileSignature?: string;
            sourceEpoch?: string;
        } = {};

        const isRelaxed = invocation?.mode === "relaxed";
        if (isRelaxed && !invocation.seed.queryEmbedding) {
            return createOperationalUnavailableResult(query, "current_source_unavailable");
        }
        const rejectedEvidence = isRelaxed
            ? createRejectedEvidenceMap(invocation.seed.rejectedEvidence)
            : undefined;
        const unchangedGenerationRefs = isRelaxed
            ? generationRefsFromRejectedEvidence(invocation.seed.rejectedEvidence)
            : [];
        const rawResults = await this.host.memorySearch.searchHybrid(query, {
            ftsQueryOverridePromise,
            temporalFilterPromise,
            signal,
            ...(Number.isFinite(invocation?.absoluteDeadlineMs)
                ? { absoluteDeadlineMs: invocation!.absoluteDeadlineMs }
                : {}),
            queryEmbeddingOut,
            ...(invocation?.providerRequestScope
                ? { providerRequestScope: invocation.providerRequestScope }
                : {}),
            ...(isRelaxed && invocation.seed.queryEmbedding
                ? {
                    queryEmbeddingOverride: {
                        value: invocation.seed.queryEmbedding.value,
                        profileSignature: invocation.seed.queryEmbedding.profileSignature,
                    },
                }
                : {}),
            ...(isRelaxed
                ? {
                    retrievalMode: "relaxed" as const,
                    excludeUnchangedPathGenerations: unchangedGenerationRefs,
                }
                : {}),
        }) as RawSearchResult[];

        throwIfAborted(signal);
        const lexicalPlan = await lexicalPlanPromise;
        const temporalFilterCapture = invocation?.mode === "standard"
            ? MEMORY_SEARCH_TEMPORAL_FILTER_CAPTURES.get(invocation)
            : undefined;
        if (temporalFilterCapture) {
            temporalFilterCapture.temporalFilter = lexicalPlan.temporalFilter
                ? { ...lexicalPlan.temporalFilter }
                : null;
        }
        if (diagnosticState) {
            diagnosticState.temporalFilterApplied = lexicalPlan.temporalFilter ? 1 : 0;
        }
        const indexedDirectCandidates = filterCandidatesByDataBoundary(
            normalizeSearchCandidates(
                rawResults,
                this.host.isDataBoundaryAllowedPath,
                isRelaxed ? RELAXED_DIRECT_RESULT_LIMIT : MAX_MEMORY_DIRECT_CANDIDATES,
            ),
            this.host.isDataBoundaryAllowedPath,
        );
        const materializedDirectCandidates = await this.materializeLatestCandidates(indexedDirectCandidates, signal);
        if (indexedDirectCandidates.length > 0 && materializedDirectCandidates.length === 0) {
            return createOperationalUnavailableResult(query, "current_source_unavailable");
        }
        const currentDirectCandidates = filterCandidatesByTemporalRange(
            materializedDirectCandidates,
            lexicalPlan.temporalFilter,
        );
        const directCandidates = (isRelaxed
            ? await this.orderFreshRecoveryCandidates(currentDirectCandidates, rejectedEvidence, signal)
            : currentDirectCandidates)
            .slice(0, MAX_MEMORY_DIRECT_CANDIDATES);
        const topologySeedPaths = selectDistinctPprSeeds(
            directCandidates.length > 0
                ? directCandidates.map((candidate) => candidate.path)
                : isRelaxed
                    ? invocation.seed.rejectedEvidence
                        .filter((entry) => entry.origin !== "graph")
                        .map((entry) => entry.path)
                    : [],
        );
        const topologyDirectPaths = new Set([
            ...directCandidates.map((candidate) => candidate.path),
            ...(directCandidates.length === 0 ? topologySeedPaths : []),
        ]);
        const indexedGraphCandidates = await this.collectGraphCandidates({
            directPaths: topologyDirectPaths,
            seedPaths: topologySeedPaths,
            queryEmbeddingOut,
            rejectedEvidence,
            invocation,
            temporalFilter: lexicalPlan.temporalFilter,
            signal,
            record,
        });
        const graphCandidates = filterCandidatesByTemporalRange(
            await this.materializeLatestCandidates(indexedGraphCandidates, signal),
            lexicalPlan.temporalFilter,
        );
        const admittedCandidates = admitRerankCandidates(
            filterCandidatesByDataBoundary(
                [...directCandidates, ...graphCandidates],
                this.host.isDataBoundaryAllowedPath,
            ),
        );
        if (diagnosticState) {
            diagnosticState.temporalViolationCount = countTemporalRangeViolations(
                admittedCandidates,
                lexicalPlan.temporalFilter,
            );
        }
        const recoverySeedBase = invocation?.mode === "standard" && invocation.captureRecoverySeed
            ? createRecoverySeed(query, lexicalPlan, [], queryEmbeddingOut)
            : undefined;

        if (admittedCandidates.length === 0) {
            return createDeterministicEmptyResult(query, recoverySeedBase);
        }

        // Model construction/admission may suspend. Complete it before sealing
        // the bounded evidence group so no stale excerpt can cross that gap.
        const preparedReranker = selectedRerankModel
            ? await this.prepareReranker(
                selectedRerankModel,
                signal,
                invocation?.absoluteDeadlineMs,
                invocation,
            )
            : null;
        let sealedRerankerInput: CoherentMaterializedCandidateSet | null;
        try {
            // Earlier direct/graph reads are proposal-only. Seal the complete
            // bounded set only after the selected model is ready.
            sealedRerankerInput = await this.materializeCoherentCandidateSet(
                admittedCandidates,
                signal,
                false,
                lexicalPlan.temporalFilter,
                invocation?.absoluteDeadlineMs,
            );
        } catch (error) {
            preparedReranker?.dispose();
            throw error;
        }
        if (!sealedRerankerInput || sealedRerankerInput.candidates.length === 0) {
            preparedReranker?.dispose();
            return createOperationalUnavailableResult(query, "current_source_unavailable");
        }
        if (diagnosticState) {
            diagnosticState.temporalViolationCount = sealedRerankerInput.temporalViolationCount;
        }
        const rerankerInput = sealedRerankerInput.candidates;

        let rerankOutcome: RerankOutcome;
        const rerankStartedAt = Date.now();
        safeRecordDiagnostic(record, {
            phase: "reranker",
            outcome: preparedReranker ? "started" : "skipped",
            ...(preparedReranker ? {} : { reason: "model_unavailable" }),
            metrics: {
                candidateCount: rerankerInput.length,
                providerCallCount: preparedReranker ? 1 : 0,
            },
        });
        try {
            if (preparedReranker) {
                // This is the last asynchronous seam before invoke. A changed
                // source/Boundary epoch must fail closed without sending the
                // previously sealed excerpts to the provider.
                if (!await this.isCoherentCandidateSetStillCurrent(
                    sealedRerankerInput,
                    signal,
                    invocation?.absoluteDeadlineMs,
                )) {
                    safeRecordDiagnostic(record, {
                        phase: "reranker",
                        outcome: "aborted",
                        reason: "source_changed",
                        metrics: { durationMs: Date.now() - rerankStartedAt },
                    });
                    return createOperationalUnavailableResult(query, "final_source_changed");
                }
                rerankOutcome = await preparedReranker.invoke(query, rerankerInput);
            } else {
                rerankOutcome = createFailOpenOutcome(rerankerInput, "model_unavailable", false);
            }
        } catch (error) {
            safeRecordDiagnostic(record, {
                phase: "reranker",
                outcome: signal?.aborted ? "aborted" : isDeadlineError(error) ? "deadline" : "failed",
                reason: diagnosticReason(error),
                metrics: { durationMs: Date.now() - rerankStartedAt },
            });
            throw error;
        } finally {
            preparedReranker?.dispose();
        }
        safeRecordDiagnostic(record, {
            phase: "reranker",
            outcome: rerankOutcome.kind === "valid" ? "completed" : "fallback",
            reason: rerankOutcome.kind === "valid" ? undefined : rerankOutcome.reason,
            metrics: {
                durationMs: Date.now() - rerankStartedAt,
                candidateCount: rerankerInput.length,
                selectedCount: rerankOutcome.candidates.length,
                providerCallCount: preparedReranker ? 1 : 0,
            },
        });
        if (!await this.isCoherentCandidateSetStillCurrent(
            sealedRerankerInput,
            signal,
            invocation?.absoluteDeadlineMs,
        )) {
            return createOperationalUnavailableResult(query, "final_source_changed", rerankOutcome);
        }
        const strictFilterEnabledAtRerank = this.isRetrievalFlagEnabled("strictReranker");
        const shouldCaptureRejectedEvidence = Boolean(
            recoverySeedBase
            && rerankOutcome.kind === "valid"
            && (
                rerankOutcome.verdict === "none_relevant" && strictFilterEnabledAtRerank
                || rerankOutcome.verdict === "partially_relevant" && rerankOutcome.needsMoreEvidence
            ),
        );
        const rejectedEvidenceBuild = shouldCaptureRejectedEvidence
            ? await this.buildRejectedEvidence(rerankerInput, sealedRerankerInput, signal)
            : undefined;
        // Fingerprint generation is asynchronous. Recheck the exact sealed
        // collection once more before any ledger/final result serialization.
        if (!await this.isCoherentCandidateSetStillCurrent(
            sealedRerankerInput,
            signal,
            invocation?.absoluteDeadlineMs,
        )) {
            return createOperationalUnavailableResult(query, "final_source_changed", rerankOutcome);
        }
        // A valid deterministic A1=empty miss is created before this branch.
        // For non-empty A1, an incomplete ledger must disable relaxed retry;
        // otherwise the same evidence would be misclassified as novel.
        const recoverySeed = rejectedEvidenceBuild?.ok
            && this.isRetrievalFlagEnabled("relaxedRecovery")
            ? createRecoverySeed(
                query,
                lexicalPlan,
                rejectedEvidenceBuild.evidence,
                queryEmbeddingOut,
            )
            : undefined;
        // Rollout flags are live. If strict mode was disabled while its model
        // or ledger was pending, the valid-none whole-set hide must roll back.
        const strictFilterEnabled = strictFilterEnabledAtRerank
            && this.isRetrievalFlagEnabled("strictReranker");
        const appliedRerank = applyRerankOutcome(rerankOutcome, rerankerInput, strictFilterEnabled);
        const selectedCandidates = appliedRerank.candidates;

        if (selectedCandidates.length === 0) {
            return createNoRelevantResult(query, rerankOutcome, recoverySeed);
        }

        // `selectedCandidates` is an ordered subset of the exact sealed objects
        // seen by the reranker and ledger. Epoch revalidation above makes it the
        // only collection eligible for final projection.
        const finalCandidates = selectedCandidates;

        const documents = allocateMemoryDocumentsTwoPass(finalCandidates, MAX_MEMORY_DOCUMENTS);
        const hasAnswerableContent = documents.length > 0;
        const effectiveVerdict = appliedRerank.verdict;
        const effectiveNeedsMoreEvidence = appliedRerank.needsMoreEvidence;
        const memoryEvidenceState = effectiveVerdict === "partially_relevant"
            ? "partial"
            : hasAnswerableContent ? "evidence" : "none";
        return {
            usedMemory: hasAnswerableContent,
            query,
            documents,
            sources: sourcesFromDocuments(documents),
            candidates: finalCandidates,
            hasAnswerableContent,
            needsSnippetFollowup: false,
            memoryEvidenceState,
            rerankVerdict: effectiveVerdict,
            needsMoreEvidence: effectiveNeedsMoreEvidence,
            ...(memoryEvidenceState === "partial" && effectiveNeedsMoreEvidence
                ? { retrievalGuidance: "The selected Memory evidence is partial; do not fill missing facts by inference." }
                : {}),
            rerankOutcome,
            ...(memoryEvidenceState === "partial" && recoverySeed ? { recoverySeed } : {}),
        };
    }

    private async rewriteQueryWithTimeout(
        query: string,
        policyModelName: string,
        signal?: AbortSignal,
        providerRequestOptions?: ProviderRequestOptions,
    ): Promise<RewrittenQuery> {
        const controller = new AbortController();
        const combined = combineAbortSignals(signal ? [signal, controller.signal] : [controller.signal]);
        const timeoutId = setPlatformTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);

        try {
            const llm = await this.aiUtils.createChatModel(0, {
                transport: "native",
                modelName: policyModelName,
                ...(providerRequestOptions?.providerRequestScope
                    ? { providerRequestScope: providerRequestOptions.providerRequestScope }
                    : {}),
            });
            const invoker = async (q: string, s?: AbortSignal) => {
                const escapedSystemPrompt = REWRITE_SYSTEM_PROMPT.replace(/\{/g, "{{").replace(/\}/g, "}}");
                const prompt = ChatPromptTemplate.fromMessages([
                    SystemMessagePromptTemplate.fromTemplate(escapedSystemPrompt),
                    HumanMessagePromptTemplate.fromTemplate("{query}"),
                ]);
                const response = await prompt.pipe(llm).invoke({ query: q }, { signal: s });
                return typeof response.content === "string" ? response.content : "";
            };
            return await rewriteQueryForSearch(query, invoker, combined.signal);
        } catch {
            return { keywords: null, temporal: "none" };
        } finally {
            clearPlatformTimeout(timeoutId);
            combined.dispose();
        }
    }

    private async rerankCandidates(
        query: string,
        candidates: MemoryCandidate[],
        selectedModel: SelectedRerankModel,
        signal?: AbortSignal,
        absoluteDeadlineMs?: number,
        providerRequestOptions?: ProviderRequestOptions,
    ): Promise<RerankOutcome> {
        throwIfAborted(signal);
        if (candidates.length === 0) {
            return createDeterministicEmptyOutcome();
        }

        const prepared = await this.prepareReranker(
            selectedModel,
            signal,
            absoluteDeadlineMs,
            providerRequestOptions,
        );
        if (!prepared) return createFailOpenOutcome(candidates, "model_unavailable", false);
        try {
            return await prepared.invoke(query, candidates);
        } finally {
            prepared.dispose();
        }
    }

    private async prepareReranker(
        selectedModel: SelectedRerankModel,
        signal?: AbortSignal,
        absoluteDeadlineMs?: number,
        providerRequestOptions?: ProviderRequestOptions,
    ): Promise<PreparedMemoryReranker | null> {
        throwIfAborted(signal);
        const controller = new AbortController();
        const combined = combineAbortSignals(signal ? [signal, controller.signal] : [controller.signal]);
        let childAbortReason: "timeout" | "policy_disabled" | "disposed" | undefined;
        const abortChild = (reason: NonNullable<typeof childAbortReason>) => {
            if (controller.signal.aborted) return;
            childAbortReason = reason;
            controller.abort();
        };
        const timeoutMs = resolveRerankTimeoutMs(absoluteDeadlineMs);
        const timeoutId = timeoutMs > 0
            ? setPlatformTimeout(() => abortChild("timeout"), timeoutMs)
            : undefined;
        if (timeoutId === undefined) abortChild("timeout");
        const strictPolicyArmed = this.isRetrievalFlagEnabled("strictReranker");
        const policyEpoch = strictPolicyArmed
            ? this.host.getRetrievalOptimizationEpoch?.()
            : undefined;
        const unsubscribePolicy = strictPolicyArmed
            ? this.host.onSettingsChanged?.(() => {
                if (
                    !this.isRetrievalFlagEnabled("strictReranker")
                    || (
                        policyEpoch !== undefined
                        && this.host.getRetrievalOptimizationEpoch?.() !== policyEpoch
                    )
                ) {
                    abortChild("policy_disabled");
                }
            })
            : undefined;
        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            unsubscribePolicy?.();
            if (timeoutId !== undefined) clearPlatformTimeout(timeoutId);
            abortChild("disposed");
            combined.dispose();
        };
        const failOpenPrepared = (
            reason: Extract<RerankFailOpenReason, "policy_disabled" | "timeout">,
            modelCalled: boolean,
        ): PreparedMemoryReranker => ({
            dispose,
            invoke: async (_query, candidates) => {
                throwIfAborted(signal);
                return candidates.length === 0
                    ? createDeterministicEmptyOutcome()
                    : createFailOpenOutcome(candidates, reason, modelCalled);
            },
        });
        if (controller.signal.aborted) {
            const reason = childAbortReason === "policy_disabled" ? "policy_disabled" : "timeout";
            const prepared = failOpenPrepared(reason, false);
            dispose();
            return prepared;
        }

        try {
            const modelResult = await settleBeforeAbort(
                Promise.resolve(this.aiUtils.createChatModel(0, {
                    transport: "native",
                    modelName: selectedModel.modelName,
                    ...(providerRequestOptions?.providerRequestScope
                        ? { providerRequestScope: providerRequestOptions.providerRequestScope }
                        : {}),
                })),
                combined.signal,
            );
            if (modelResult.type === "aborted") {
                throwIfAborted(signal);
                const reason = childAbortReason === "policy_disabled"
                    ? "policy_disabled"
                    : "timeout";
                const prepared = failOpenPrepared(reason, false);
                dispose();
                return prepared;
            }
            if (modelResult.type === "rejected") throw modelResult.error;
            throwIfAborted(signal);
            const llm = modelResult.value;
            const escapedRerankPrompt = RERANK_SYSTEM_PROMPT.replace(/\{/g, "{{").replace(/\}/g, "}}");
            const prompt = ChatPromptTemplate.fromMessages([
                SystemMessagePromptTemplate.fromTemplate(escapedRerankPrompt),
                HumanMessagePromptTemplate.fromTemplate("Query: {query}\n\nCandidates:\n{candidates}"),
            ]);
            const chain = prompt.pipe(llm);
            return {
                dispose,
                invoke: async (query, candidates) => {
                    throwIfAborted(signal);
                    if (candidates.length === 0) return createDeterministicEmptyOutcome();
                    if (controller.signal.aborted) {
                        throwIfAborted(signal);
                        return createFailOpenOutcome(
                            candidates,
                            childAbortReason === "policy_disabled"
                                ? "policy_disabled"
                                : "timeout",
                            false,
                        );
                    }
                    const candidateList = candidates
                        .map((candidate, index) => {
                            const heading = candidate.anchor?.headingPath?.length
                                ? ` (${candidate.anchor.headingPath.join(" > ")})`
                                : "";
                            return `[${index}] ${candidate.path}${heading}: ${candidate.excerpt.slice(0, MAX_MEMORY_CANDIDATE_EXCERPT_CHARS)}`;
                        })
                        .join("\n");
                    try {
                        const providerResult = await settleBeforeAbort(
                            Promise.resolve(chain.invoke(
                                { query, candidates: candidateList },
                                { signal: combined.signal },
                            )),
                            combined.signal,
                        );
                        if (providerResult.type === "aborted") {
                            throwIfAborted(signal);
                            return createFailOpenOutcome(
                                candidates,
                                childAbortReason === "policy_disabled"
                                    ? "policy_disabled"
                                    : "timeout",
                                true,
                            );
                        }
                        if (providerResult.type === "rejected") throw providerResult.error;
                        throwIfAborted(signal);
                        const response = providerResult.value;
                        const content = typeof response.content === "string" ? response.content : "";
                        return parseRerankResponse(content, candidates);
                    } catch {
                        throwIfAborted(signal);
                        return createFailOpenOutcome(
                            candidates,
                            childAbortReason === "policy_disabled"
                                ? "policy_disabled"
                                : childAbortReason === "timeout" ? "timeout" : "provider_error",
                            true,
                        );
                    }
                },
            };
        } catch {
            dispose();
            throwIfAborted(signal);
            if (childAbortReason === "policy_disabled") {
                return failOpenPrepared("policy_disabled", false);
            }
            if (childAbortReason === "timeout") {
                return failOpenPrepared("timeout", false);
            }
            return null;
        }
    }

    private async materializeLatestCandidates(
        candidates: readonly MemoryCandidate[],
        signal?: AbortSignal,
        requireSameSnapshot = false,
    ): Promise<MemoryCandidate[]> {
        const materialized: MemoryCandidate[] = [];
        for (const candidate of candidates) {
            throwIfAborted(signal);
            try {
                const current = await this.materializeLatestCandidate(candidate, signal, requireSameSnapshot);
                if (current) materialized.push(current);
            } catch {
                if (signal?.aborted) throw createAbortError();
            }
        }
        return materialized;
    }

    private async materializeLatestCandidate(
        candidate: MemoryCandidate,
        signal?: AbortSignal,
        requireSameSnapshot = false,
    ): Promise<MemoryCandidate | null> {
        const readLatest = this.host.readLatestMemorySource;
        if (!readLatest) return null;
        const source = await readLatest.call(this.host, candidate.path, signal);
        throwIfAborted(signal);
        if (!source) return null;
        return materializeCandidateFromLatestSource(
            candidate,
            source,
            {
                cleanMarkdown: (markdown) => this.aiUtils.cleanMarkdownContent(markdown),
                hashContent: (content) => this.aiUtils.hashContent(content),
            },
            requireSameSnapshot,
        );
    }

    private async materializeCoherentCandidateSet(
        candidates: readonly MemoryCandidate[],
        signal?: AbortSignal,
        requireSameSnapshot = false,
        temporalFilter: MemoryTemporalFilter | null = null,
        absoluteDeadlineMs?: number,
    ): Promise<CoherentMaterializedCandidateSet | null> {
        const getBoundaryEpoch = this.host.getMemoryEvidenceEpoch;
        if (!getBoundaryEpoch || !this.host.readLatestMemorySource) return null;
        const canonicalCandidates = admitRerankCandidates([...candidates]);
        if (canonicalCandidates.length === 0) return null;

        // One bounded retry handles an epoch that moves while the group is
        // being read. A second drift fails the complete set closed.
        for (let attempt = 0; attempt < 2; attempt++) {
            throwIfAborted(signal);
            try {
                const boundaryEpoch = getBoundaryEpoch.call(this.host);
                const paths = canonicalCandidates.map((candidate) => candidate.path);
                const before = await this.host.memorySearch.getPathEvidenceGenerations(paths, {
                    signal,
                    ...(Number.isFinite(absoluteDeadlineMs) ? { absoluteDeadlineMs } : {}),
                });
                throwIfAborted(signal);
                if (
                    !before.sourceEpoch
                    || getBoundaryEpoch.call(this.host) !== boundaryEpoch
                ) continue;
                const beforeByPath = currentGenerationMap(before.paths);
                const eligible = canonicalCandidates.filter((candidate) => {
                    const path = canonicalMarkdownPath(candidate.path);
                    return Boolean(
                        path
                        && beforeByPath.has(path)
                        && this.host.isDataBoundaryAllowedPath?.(path) !== false,
                    );
                });
                if (eligible.length === 0) {
                    if (getBoundaryEpoch.call(this.host) !== boundaryEpoch) continue;
                    return {
                        candidates: [],
                        sourceEpoch: before.sourceEpoch,
                        boundaryEpoch,
                        generations: new Map(),
                        temporalViolationCount: 0,
                    };
                }

                const materialized = filterCandidatesByTemporalRange(
                    await this.materializeLatestCandidates(
                        eligible,
                        signal,
                        requireSameSnapshot,
                    ),
                    temporalFilter,
                );
                throwIfAborted(signal);
                if (getBoundaryEpoch.call(this.host) !== boundaryEpoch) continue;
                if (materialized.length === 0) {
                    return {
                        candidates: [],
                        sourceEpoch: before.sourceEpoch,
                        boundaryEpoch,
                        generations: new Map(),
                        temporalViolationCount: 0,
                    };
                }

                const after = await this.host.memorySearch.getPathEvidenceGenerations(
                    materialized.map((candidate) => candidate.path),
                    {
                        signal,
                        ...(Number.isFinite(absoluteDeadlineMs) ? { absoluteDeadlineMs } : {}),
                    },
                );
                throwIfAborted(signal);
                if (
                    after.sourceEpoch !== before.sourceEpoch
                    || getBoundaryEpoch.call(this.host) !== boundaryEpoch
                ) continue;
                const afterByPath = currentGenerationMap(after.paths);
                const generations = new Map<string, string>();
                let coherent = true;
                for (const candidate of materialized) {
                    const path = canonicalMarkdownPath(candidate.path);
                    const beforeGeneration = path ? beforeByPath.get(path) : undefined;
                    const afterGeneration = path ? afterByPath.get(path) : undefined;
                    if (
                        !path
                        || !beforeGeneration
                        || beforeGeneration !== afterGeneration
                        || this.host.isDataBoundaryAllowedPath?.(path) === false
                    ) {
                        coherent = false;
                        break;
                    }
                    generations.set(path, beforeGeneration);
                }
                if (!coherent || getBoundaryEpoch.call(this.host) !== boundaryEpoch) continue;
                return {
                    candidates: materialized,
                    sourceEpoch: before.sourceEpoch,
                    boundaryEpoch,
                    generations,
                    temporalViolationCount: countTemporalRangeViolations(
                        materialized,
                        temporalFilter,
                    ),
                };
            } catch {
                if (signal?.aborted) throw createAbortError();
            }
        }
        return null;
    }

    private async isCoherentCandidateSetStillCurrent(
        sealed: CoherentMaterializedCandidateSet,
        signal?: AbortSignal,
        absoluteDeadlineMs?: number,
    ): Promise<boolean> {
        const getBoundaryEpoch = this.host.getMemoryEvidenceEpoch;
        if (!getBoundaryEpoch || getBoundaryEpoch.call(this.host) !== sealed.boundaryEpoch) return false;
        try {
            const status = await this.host.memorySearch.getPathEvidenceGenerations(
                sealed.candidates.map((candidate) => candidate.path),
                {
                    signal,
                    ...(Number.isFinite(absoluteDeadlineMs) ? { absoluteDeadlineMs } : {}),
                },
            );
            throwIfAborted(signal);
            if (
                status.sourceEpoch !== sealed.sourceEpoch
                || getBoundaryEpoch.call(this.host) !== sealed.boundaryEpoch
            ) return false;
            const current = currentGenerationMap(status.paths);
            return sealed.candidates.every((candidate) => {
                const path = canonicalMarkdownPath(candidate.path);
                return Boolean(
                    path
                    && current.get(path) === sealed.generations.get(path)
                    && this.host.isDataBoundaryAllowedPath?.(path) !== false,
                );
            }) && getBoundaryEpoch.call(this.host) === sealed.boundaryEpoch;
        } catch {
            if (signal?.aborted) throw createAbortError();
            return false;
        }
    }

    private async orderFreshRecoveryCandidates(
        candidates: readonly MemoryCandidate[],
        rejectedEvidence?: ReadonlyMap<string, MemoryRejectedEvidence>,
        signal?: AbortSignal,
    ): Promise<MemoryCandidate[]> {
        if (!rejectedEvidence || rejectedEvidence.size === 0) return [...candidates];
        const novel: MemoryCandidate[] = [];
        const changed: MemoryCandidate[] = [];
        for (const candidate of candidates) {
            throwIfAborted(signal);
            const path = canonicalMarkdownPath(candidate.path);
            if (!path) continue;
            const rejected = rejectedEvidence.get(path);
            if (!rejected) {
                novel.push(candidate);
                continue;
            }
            if (
                candidate.pathEvidenceGeneration
                && candidate.pathEvidenceGeneration === rejected.pathEvidenceGeneration
            ) continue;
            const fingerprint = await createRerankerVisibleEvidenceFingerprint(candidate, this.aiUtils);
            throwIfAborted(signal);
            if (rejected.evidenceFingerprints.includes(fingerprint)) continue;
            changed.push(candidate);
        }
        return [...novel, ...changed];
    }

    private async buildRejectedEvidence(
        candidates: readonly MemoryCandidate[],
        sealed: CoherentMaterializedCandidateSet,
        signal?: AbortSignal,
    ): Promise<RejectedEvidenceBuildResult> {
        if (candidates.length === 0) return { ok: true, evidence: [] };
        try {
            const rejected: MemoryRejectedEvidence[] = [];
            const seen = new Set<string>();
            for (const candidate of candidates) {
                const path = canonicalMarkdownPath(candidate.path);
                const generation = path ? sealed.generations.get(path) : undefined;
                if (!path || !generation || seen.has(path)) return { ok: false };
                seen.add(path);
                rejected.push({
                    path,
                    pathEvidenceGeneration: generation,
                    evidenceFingerprints: [await createRerankerVisibleEvidenceFingerprint(candidate, this.aiUtils)],
                    origin: candidate.origin === "graph" ? "graph" : "direct",
                });
                throwIfAborted(signal);
            }
            return rejected.length === candidates.length
                ? { ok: true, evidence: rejected }
                : { ok: false };
        } catch {
            if (signal?.aborted) throw createAbortError();
            return { ok: false };
        }
    }

    private async collectGraphCandidates(input: {
        directPaths: ReadonlySet<string>;
        seedPaths: readonly string[];
        queryEmbeddingOut: { value?: number[]; profileSignature?: string; sourceEpoch?: string };
        rejectedEvidence?: ReadonlyMap<string, MemoryRejectedEvidence>;
        invocation?: MemorySearchInvocationOptions;
        temporalFilter: { since?: number; until?: number } | null;
        signal?: AbortSignal;
        record?: RetrievalDiagnosticRecorder;
    }): Promise<MemoryCandidate[]> {
        if (
            !this.isGraphPprEnabled()
            || input.seedPaths.length === 0
            || !input.queryEmbeddingOut.value
            || !input.queryEmbeddingOut.sourceEpoch
        ) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_snapshot",
                outcome: "skipped",
                reason: !this.isGraphPprEnabled()
                    ? "flag_off"
                    : input.seedPaths.length === 0
                        ? "no_seeds"
                        : "embedding_unavailable",
            });
            return [];
        }
        const source = this.host.getGraphBoundarySnapshotSource?.();
        if (!source) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_snapshot",
                outcome: "skipped",
                reason: "source_unavailable",
            });
            return [];
        }

        const now = Date.now();
        const absoluteDeadlineMs = Math.min(
            input.invocation?.absoluteDeadlineMs ?? Number.POSITIVE_INFINITY,
            now + PROVISIONAL_EC02_GRAPH.budgetMs,
        );
        if (absoluteDeadlineMs <= now) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_snapshot",
                outcome: "deadline",
                reason: "deadline_elapsed",
            });
            return [];
        }
        const snapshotStartedAt = Date.now();
        safeRecordDiagnostic(input.record, {
            phase: "graph_snapshot",
            outcome: "started",
            metrics: { seedCount: input.seedPaths.length, remainingMs: absoluteDeadlineMs - now },
        });
        const snapshotResult = await buildGraphBoundarySnapshot(
            source,
            createProvisionalSnapshotLimits(absoluteDeadlineMs),
            { signal: input.signal },
        );
        if (input.signal?.aborted) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_snapshot",
                outcome: "aborted",
                reason: "parent_aborted",
                metrics: { durationMs: Date.now() - snapshotStartedAt },
            });
            throw createAbortError();
        }
        if (!snapshotResult.ok || source.getEpoch() !== snapshotResult.snapshot.epoch) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_snapshot",
                outcome: !snapshotResult.ok && snapshotResult.reason === "aborted"
                    ? "aborted"
                    : !snapshotResult.ok && snapshotResult.reason === "deadline"
                        ? "deadline"
                        : "fallback",
                reason: !snapshotResult.ok ? snapshotResult.reason : "epoch_changed",
                metrics: {
                    durationMs: Date.now() - snapshotStartedAt,
                    nodeCount: snapshotResult.estimate.snapshotNodes,
                    edgeCount: snapshotResult.estimate.snapshotEdges,
                    snapshotBytes: snapshotResult.estimate.snapshotBytes,
                },
            });
            return [];
        }
        const snapshot = snapshotResult.snapshot;
        safeRecordDiagnostic(input.record, {
            phase: "graph_snapshot",
            outcome: "completed",
            metrics: {
                durationMs: Date.now() - snapshotStartedAt,
                nodeCount: snapshot.snapshotNodes,
                edgeCount: snapshot.snapshotEdges,
                snapshotBytes: snapshot.snapshotBytes,
                opaqueBridgeCount: [...snapshot.pathClasses.values()]
                    .filter((value) => value === "opaque_excluded_markdown").length,
            },
        });
        const seeds = selectDistinctPprSeeds(input.seedPaths)
            .filter((path) => snapshot.pathClasses.get(path) === "allowed_markdown");
        if (seeds.length === 0) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_preflight",
                outcome: "skipped",
                reason: "filtered_no_seeds",
            });
            return [];
        }

        const preflightStartedAt = Date.now();
        safeRecordDiagnostic(input.record, {
            phase: "graph_preflight",
            outcome: "started",
            metrics: { seedCount: seeds.length, remainingMs: absoluteDeadlineMs - Date.now() },
        });
        const [completeLocal, graphBuild] = await runInterruptibleParallelGroup(
            input.signal,
            (groupSignal) => [
                collectCompleteLocalCandidatePaths(
                    snapshot,
                    seeds,
                    input.directPaths,
                    {
                        maxLocalCandidatePaths: PROVISIONAL_EC02_GRAPH.maxLocalCandidatePaths,
                        absoluteDeadlineMs,
                    },
                    { signal: groupSignal },
                ),
                buildBoundaryStateGraph(
                    snapshot,
                    seeds,
                    input.directPaths,
                    createProvisionalGraphWorkLimits(absoluteDeadlineMs),
                    { signal: groupSignal },
                ),
            ] as const,
        );
        if (input.signal?.aborted) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_preflight",
                outcome: "aborted",
                reason: "parent_aborted",
                metrics: { durationMs: Date.now() - preflightStartedAt },
            });
            throw createAbortError();
        }
        const graphEstimate = graphBuild.ok ? graphBuild.graph.estimate : graphBuild.estimate;
        const preflightDiagnostic = resolveGraphPreflightDiagnostic(
            completeLocal.ok ? undefined : completeLocal.reason,
            graphBuild.ok ? undefined : graphBuild.reason,
        );
        safeRecordDiagnostic(input.record, {
            phase: "graph_preflight",
            outcome: preflightDiagnostic.outcome,
            reason: preflightDiagnostic.reason,
            metrics: {
                durationMs: Date.now() - preflightStartedAt,
                liftedStateCount: graphEstimate.liftedStates,
                transitionCount: graphEstimate.legalTransitions,
                projectedOperations: graphEstimate.projectedSolverOperations,
                projectedBytes: graphEstimate.projectedBytes,
                localCount: completeLocal.ok ? completeLocal.paths.size : completeLocal.localCandidatePaths,
            },
        });
        if (
            !completeLocal.ok && completeLocal.reason === "invalid_graph"
            || !graphBuild.ok && (
                graphBuild.reason === "invalid_graph"
                || graphBuild.reason === "snapshot_budget"
            )
        ) return [];
        const localPaths = completeLocal.ok ? completeLocal.paths : new Set<string>();
        const semanticLocalPaths = graphBuild.ok
            ? graphBuild.graph.localCandidatePaths
            : localPaths;

        let seedEvidence: ReturnType<typeof collectSuccessfulSeedEvidence> = null;
        if (graphBuild.ok && shouldActivatePpr(graphBuild.graph, seeds, input.directPaths)) {
            const solveStartedAt = Date.now();
            safeRecordDiagnostic(input.record, {
                phase: "ppr_solve",
                outcome: "started",
                metrics: { seedCount: seeds.length, remainingMs: absoluteDeadlineMs - Date.now() },
            });
            const solves = await runInterruptibleParallelGroup(
                input.signal,
                (groupSignal) => seeds.map((seed) => solvePersonalizedPageRank(
                    graphBuild.graph,
                    seed,
                    { signal: groupSignal, absoluteDeadlineMs },
                )),
            );
            if (input.signal?.aborted) {
                safeRecordDiagnostic(input.record, {
                    phase: "ppr_solve",
                    outcome: "aborted",
                    reason: "parent_aborted",
                    metrics: { durationMs: Date.now() - solveStartedAt },
                });
                throw createAbortError();
            }
            seedEvidence = collectSuccessfulSeedEvidence(seeds, solves);
            const converged = solves.filter((result) => result.converged);
            for (const result of solves) {
                safeRecordDiagnostic(input.record, {
                    phase: "ppr_solve",
                    outcome: result.converged ? "completed" : result.reason === "deadline"
                        ? "deadline"
                        : result.reason === "aborted" ? "aborted" : "fallback",
                    reason: result.converged ? undefined : result.reason,
                    metrics: result.converged
                        ? {
                            seedCount: 1,
                            iterationCount: result.iteration,
                            errorBound: result.errorBound,
                        }
                        : { seedCount: 1 },
                });
            }
            safeRecordDiagnostic(input.record, {
                phase: "ppr_solve",
                outcome: seedEvidence ? "completed" : "fallback",
                reason: seedEvidence ? undefined : "solve_unavailable",
                metrics: {
                    durationMs: Date.now() - solveStartedAt,
                    seedCount: seeds.length,
                    convergenceCount: converged.length,
                },
            });
        } else {
            safeRecordDiagnostic(input.record, {
                phase: "ppr_solve",
                outcome: "skipped",
                reason: graphBuild.ok ? "activation_not_met" : "preflight_unavailable",
            });
        }
        if (localPaths.size === 0 && !seedEvidence) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "fallback",
                reason: "workset_empty",
            });
            return [];
        }

        const currentness = await this.resolveCurrentRecoveryGenerations(
            input.rejectedEvidence,
            input.queryEmbeddingOut.sourceEpoch,
            input.signal,
            absoluteDeadlineMs,
        );
        if (!currentness.coherent) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "aborted",
                reason: "currentness_changed",
            });
            return [];
        }
        const earlyExclusions = new Set(currentness.exactRepeatPaths);
        const probeWorksets = buildGraphLaneWorksets(
            seedEvidence ?? [],
            input.directPaths,
            semanticLocalPaths,
            {
                deepBreadthTopN: PROVISIONAL_EC02_GRAPH.probeTopN,
                convergenceTopN: PROVISIONAL_EC02_GRAPH.probeTopN,
            },
            earlyExclusions,
            localPaths,
        );
        safeRecordDiagnostic(input.record, {
            phase: "graph_workset",
            outcome: "completed",
            metrics: {
                localCount: probeWorksets.localPaths.length,
                deepCount: probeWorksets.deepBreadth.length,
                convergenceCount: probeWorksets.convergence.length,
                unionCount: probeWorksets.union.length,
            },
        });
        const boundaryAllowedWorkerPaths = probeWorksets.union
            .map((entry) => entry.path)
            .filter((path) => snapshot.pathClasses.get(path) === "allowed_markdown")
            .filter((path) => this.host.isDataBoundaryAllowedPath?.(path) !== false);
        if (boundaryAllowedWorkerPaths.length !== probeWorksets.union.length) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "aborted",
                reason: "boundary_changed",
            });
            return [];
        }
        const workerPaths = await this.filterCurrentGraphWorkerPaths(
            boundaryAllowedWorkerPaths,
            input.queryEmbeddingOut.sourceEpoch,
            input.temporalFilter ?? undefined,
            input.signal,
            absoluteDeadlineMs,
        );
        if (workerPaths === null) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "aborted",
                reason: "currentness_changed",
            });
            return [];
        }
        if (workerPaths.length === 0) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "fallback",
                reason: "workset_empty",
            });
            return [];
        }
        if (workerPaths.length > PROVISIONAL_EC02_GRAPH.maxCandidatePaths) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "fallback",
                reason: "workset_budget",
                metrics: { candidateCount: workerPaths.length },
            });
            return [];
        }

        const requestId = createGraphRequestId(input.invocation?.runEpoch);
        const runEpoch = input.invocation?.runEpoch ?? requestId;
        const control: RankedPathRequestControl = {
            requestId,
            runEpoch,
            sourceEpoch: input.queryEmbeddingOut.sourceEpoch,
            absoluteDeadlineMs,
            maxPathsPerBatch: PROVISIONAL_EC02_GRAPH.maxPathsPerBatch,
            maxCandidatePaths: PROVISIONAL_EC02_GRAPH.maxCandidatePaths,
            maxChunksScanned: PROVISIONAL_EC02_GRAPH.maxChunksScanned,
        };
        if (!this.isGraphPprEnabled()) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_worker",
                outcome: "aborted",
                reason: "flag_changed",
                metrics: { cancelRequested: 0, acceptedCount: 0 },
            });
            return [];
        }
        let cancelRequestedInRequest = 0;
        let diagnosticsCancellationInvoked = false;
        let queueReleaseProbePromise: Promise<void> | null = null;
        const activeRequest = this.beginGraphRankRequest(control, input.signal);
        if (!activeRequest) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_worker",
                outcome: "failed",
                reason: "request_unavailable",
                metrics: { cancelRequested: 0, acceptedCount: 0 },
            });
            return [];
        }
        let rankedPaths: RankedPathChunks[];
        const workerStartedAt = Date.now();
        safeRecordDiagnostic(input.record, {
            phase: "graph_worker",
            outcome: "started",
            metrics: { candidateCount: workerPaths.length, remainingMs: absoluteDeadlineMs - Date.now() },
        });
        try {
            const ranked = await this.host.memorySearch.rankGraphCandidates(
                input.queryEmbeddingOut.value,
                workerPaths,
                control,
                {
                    signal: activeRequest.controller.signal,
                    onDiagnostic: (event) => {
                        if (event.state === "dispatched") {
                            this.host.scheduleArmedGraphWorkerCancellation?.(
                                this.diagnosticSurface,
                                () => {
                                    if (this.isGraphRankRequestCurrent(activeRequest)) {
                                        diagnosticsCancellationInvoked = true;
                                        this.invalidateGraphRankRequest(activeRequest);
                                    }
                                },
                            );
                        } else if (event.state === "cancel_requested") {
                            cancelRequestedInRequest = 1;
                            safeRecordDiagnostic(input.record, {
                                phase: "graph_worker",
                                outcome: "aborted",
                                reason: "cancel_requested",
                                metrics: { cancelRequested: cancelRequestedInRequest, acceptedCount: 0 },
                            });
                            if (diagnosticsCancellationInvoked && !queueReleaseProbePromise) {
                                queueReleaseProbePromise = this.runGraphQueueReleaseProbe(
                                    workerPaths[0],
                                    input.record,
                                );
                            }
                        } else if (event.state === "cancel_observed") {
                            safeRecordDiagnostic(input.record, {
                                phase: "graph_worker",
                                outcome: "aborted",
                                reason: "cancel_observed",
                                metrics: {
                                    cancelRequested: cancelRequestedInRequest,
                                    cancelObserved: 1,
                                    acceptedCount: 0,
                                },
                            });
                        } else if (event.state === "late_discarded") {
                            safeRecordDiagnostic(input.record, {
                                phase: "graph_worker",
                                outcome: "late_discarded",
                                reason: "late_result",
                                metrics: {
                                    cancelRequested: cancelRequestedInRequest,
                                    lateDiscardCount: 1,
                                    acceptedCount: 0,
                                },
                            });
                        }
                    },
                },
            );
            throwIfAborted(input.signal);
            if (!this.isGraphRankRequestCurrent(activeRequest)) {
                safeRecordDiagnostic(input.record, {
                    phase: "graph_worker",
                    outcome: "late_discarded",
                    reason: "request_invalidated",
                    metrics: {
                        cancelRequested: cancelRequestedInRequest,
                        lateDiscardCount: 1,
                        acceptedCount: 0,
                    },
                });
                return [];
            }
            if (
                Date.now() >= absoluteDeadlineMs
                || ranked.requestId !== requestId
                || ranked.runEpoch !== runEpoch
                || ranked.sourceEpoch !== control.sourceEpoch
                || source.getEpoch() !== snapshot.epoch
            ) {
                safeRecordDiagnostic(input.record, {
                    phase: "graph_worker",
                    outcome: "late_discarded",
                    reason: Date.now() >= absoluteDeadlineMs ? "deadline_elapsed" : "epoch_changed",
                    metrics: {
                        cancelRequested: cancelRequestedInRequest,
                        lateDiscardCount: 1,
                        acceptedCount: 0,
                    },
                });
                return [];
            }
            rankedPaths = ranked.paths;
            safeRecordDiagnostic(input.record, {
                phase: "graph_worker",
                outcome: "completed",
                metrics: {
                    durationMs: Date.now() - workerStartedAt,
                    candidateCount: workerPaths.length,
                    batchCount: ranked.diagnostics?.batchCount ?? 0,
                    chunkCount: ranked.diagnostics?.chunkCount ?? 0,
                    queueWaitMs: ranked.diagnostics?.queueWaitMs ?? 0,
                    workerDurationMs: ranked.diagnostics?.workerDurationMs ?? 0,
                    maxBatchDurationMs: ranked.diagnostics?.maxBatchDurationMs ?? 0,
                    cancelRequested: cancelRequestedInRequest,
                    acceptedCount: 1,
                },
            });
        } catch (error) {
            this.invalidateGraphRankRequest(activeRequest);
            const reason = diagnosticReason(error);
            const parentAborted = input.signal?.aborted === true;
            const failureOutcome = resolveGraphWorkerFailureOutcome(
                reason,
                parentAborted,
                isDeadlineError(error),
            );
            if (shouldRecordGraphWorkerFailureTerminal(
                reason,
                cancelRequestedInRequest,
                parentAborted,
            )) {
                safeRecordDiagnostic(input.record, {
                    phase: "graph_worker",
                    outcome: failureOutcome,
                    reason,
                    metrics: {
                        durationMs: Date.now() - workerStartedAt,
                        cancelRequested: cancelRequestedInRequest,
                        acceptedCount: 0,
                    },
                });
            }
            if (input.signal?.aborted) throw createAbortError();
            return [];
        } finally {
            if (queueReleaseProbePromise) await queueReleaseProbePromise;
            this.finishGraphRankRequest(activeRequest);
        }

        const candidateByPath = new Map<string, MemoryCandidate>();
        const cosineByPath = new Map<string, number>();
        for (const ranked of rankedPaths) {
            const path = canonicalMarkdownPath(ranked.path);
            if (
                !path
                || !workerPaths.includes(path)
                || snapshot.pathClasses.get(path) !== "allowed_markdown"
                || this.host.isDataBoundaryAllowedPath?.(path) === false
            ) {
                safeRecordDiagnostic(input.record, {
                    phase: "graph_workset",
                    outcome: "failed",
                    reason: "ranked_path_invalid",
                });
                return [];
            }
            const candidate = createGraphCandidateFromRankedPath(ranked, this.host.isDataBoundaryAllowedPath);
            if (!candidate || !Number.isFinite(ranked.maxScore)) {
                safeRecordDiagnostic(input.record, {
                    phase: "graph_workset",
                    outcome: "failed",
                    reason: "ranked_candidate_invalid",
                });
                return [];
            }
            candidateByPath.set(path, candidate);
            cosineByPath.set(path, ranked.maxScore);
        }
        if (candidateByPath.size !== new Set(workerPaths).size) {
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: "failed",
                reason: "ranked_set_incomplete",
            });
            return [];
        }

        const lateExclusions = new Set(earlyExclusions);
        for (const [path, candidate] of candidateByPath) {
            const rejected = input.rejectedEvidence?.get(path);
            if (!rejected || lateExclusions.has(path)) continue;
            const current = await this.materializeLatestCandidate(candidate, input.signal);
            if (!current) {
                lateExclusions.add(path);
                continue;
            }
            const fingerprint = await createRerankerVisibleEvidenceFingerprint(current, this.aiUtils);
            throwIfAborted(input.signal);
            if (rejected.evidenceFingerprints.includes(fingerprint)) {
                lateExclusions.add(path);
            } else {
                candidateByPath.set(path, current);
            }
        }

        // The probe envelope is wider than the selecting Top-N by the maximum
        // first-attempt ledger size. Rebuilding from the complete PPR score
        // maps/local cosine set means changed-but-visible repeats consume only
        // bounded probe work, never a lane Top-N or graph-six seat.
        const finalWorksets = buildGraphLaneWorksets(
            seedEvidence ?? [],
            input.directPaths,
            semanticLocalPaths,
            {
                deepBreadthTopN: PROVISIONAL_EC02_GRAPH.laneTopN,
                convergenceTopN: PROVISIONAL_EC02_GRAPH.laneTopN,
            },
            lateExclusions,
            localPaths,
        );
        const joined = joinRankedGraphWorksets(
            finalWorksets,
            cosineByPath,
            { localTopN: PROVISIONAL_EC02_GRAPH.laneTopN },
            lateExclusions,
        );
        const selected = allocateGraphCandidates(joined, input.directPaths, {
            cosineThreshold: input.invocation?.mode === "relaxed"
                ? PROVISIONAL_EC02_GRAPH.cosine.relaxed
                : PROVISIONAL_EC02_GRAPH.cosine.standard,
            maxGraphCandidates: MAX_MEMORY_GRAPH_CANDIDATES,
            excludedCandidatePaths: lateExclusions,
        });
        throwIfAborted(input.signal);
        // Exact-repeat push-down is only sound while every excluded generation
        // remains Host-current. Recheck at the final allocation seam so a
        // dirty/changed path during Worker or live fingerprint work invalidates
        // the complete graph lane instead of silently hiding changed evidence.
        if (currentness.exactRepeatPaths.size > 0) {
            const rechecked = await this.resolveCurrentRecoveryGenerations(
                input.rejectedEvidence,
                input.queryEmbeddingOut.sourceEpoch,
                input.signal,
                absoluteDeadlineMs,
            );
            if (
                !rechecked.coherent
                || [...currentness.exactRepeatPaths].some((path) => !rechecked.exactRepeatPaths.has(path))
            ) {
                safeRecordDiagnostic(input.record, {
                    phase: "graph_workset",
                    outcome: "aborted",
                    reason: "currentness_changed",
                });
                return [];
            }
        }
        if (
            Date.now() >= absoluteDeadlineMs
            || source.getEpoch() !== snapshot.epoch
            || !this.isGraphPprEnabled()
        ) {
            this.host.memorySearch.cancelGraphCandidateRank(requestId, runEpoch);
            safeRecordDiagnostic(input.record, {
                phase: "graph_workset",
                outcome: Date.now() >= absoluteDeadlineMs ? "deadline" : "aborted",
                reason: Date.now() >= absoluteDeadlineMs
                    ? "deadline_elapsed"
                    : !this.isGraphPprEnabled() ? "flag_changed" : "epoch_changed",
            });
            return [];
        }
        safeRecordDiagnostic(input.record, {
            phase: "graph_workset",
            outcome: "completed",
            metrics: {
                selectedCount: selected.length,
                cosinePassCount: selected.length,
            },
        });
        return selected.flatMap((entry) => {
            if (
                snapshot.pathClasses.get(entry.path) !== "allowed_markdown"
                || this.host.isDataBoundaryAllowedPath?.(entry.path) === false
            ) return [];
            const candidate = candidateByPath.get(entry.path);
            return candidate ? [{ ...candidate, origin: "graph" as const }] : [];
        });
    }

    /**
     * After the diagnostics-only same-Worker cancellation has been requested,
     * enqueue one independent foreground lookup. The lookup deliberately uses
     * a fresh signal so it proves that VSS runExclusive and the SQLite Worker
     * queue become usable again; no path or returned content enters diagnostics.
     */
    private async runGraphQueueReleaseProbe(
        path: string | undefined,
        record?: RetrievalDiagnosticRecorder,
    ): Promise<void> {
        const startedAt = Date.now();
        safeRecordDiagnostic(record, {
            phase: "queue_release",
            outcome: "started",
        });
        if (!path || this.host.isDataBoundaryAllowedPath?.(path) === false) {
            safeRecordDiagnostic(record, {
                phase: "queue_release",
                outcome: "failed",
                reason: "queue_release_empty",
                metrics: { durationMs: Date.now() - startedAt, resultCount: 0 },
            });
            return;
        }

        const controller = new AbortController();
        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setPlatformTimeout> | undefined;
        try {
            const timeout = new Promise<never>((_resolve, reject) => {
                timeoutHandle = setPlatformTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    reject(Object.assign(new Error("Graph queue-release probe timed out."), {
                        code: "queue-release-timeout",
                    }));
                }, GRAPH_QUEUE_RELEASE_PROBE_TIMEOUT_MS);
            });
            const results = await Promise.race([
                this.host.memorySearch.getChunksByPath(
                    [path],
                    { limitPerPath: 1, signal: controller.signal },
                ),
                timeout,
            ]);
            const resultCount = Array.isArray(results) ? results.length : 0;
            if (resultCount !== 1) {
                safeRecordDiagnostic(record, {
                    phase: "queue_release",
                    outcome: "failed",
                    reason: resultCount === 0
                        ? "queue_release_empty"
                        : "queue_release_count_invalid",
                    metrics: { durationMs: Date.now() - startedAt, resultCount },
                });
                return;
            }
            safeRecordDiagnostic(record, {
                phase: "queue_release",
                outcome: "completed",
                metrics: { durationMs: Date.now() - startedAt, resultCount },
            });
        } catch {
            safeRecordDiagnostic(record, {
                phase: "queue_release",
                outcome: timedOut ? "deadline" : "failed",
                reason: timedOut ? "queue_release_timeout" : "queue_release_error",
                metrics: { durationMs: Date.now() - startedAt, resultCount: 0 },
            });
        } finally {
            if (timeoutHandle !== undefined) clearPlatformTimeout(timeoutHandle);
        }
    }

    private async filterCurrentGraphWorkerPaths(
        paths: readonly string[],
        expectedSourceEpoch: string,
        temporalFilter?: { since?: number; until?: number },
        signal?: AbortSignal,
        absoluteDeadlineMs?: number,
    ): Promise<string[] | null> {
        try {
            const result = await this.host.memorySearch.getPathEvidenceGenerations(
                [...paths],
                {
                    signal,
                    ...(Number.isFinite(absoluteDeadlineMs) ? { absoluteDeadlineMs } : {}),
                },
            );
            throwIfAborted(signal);
            if (result.sourceEpoch !== expectedSourceEpoch || result.paths.length !== paths.length) {
                return null;
            }
            const currentByPath = new Map(result.paths.map((entry) => [entry.path, entry]));
            const filtered: string[] = [];
            for (const path of paths) {
                const status = currentByPath.get(path);
                if (!status) return null;
                if (!status.current || !status.generation) continue;
                if (temporalFilter) {
                    if (!Number.isFinite(status.mtime)) return null;
                    if (!isTimestampWithinTemporalRange(status.mtime!, temporalFilter)) continue;
                }
                filtered.push(path);
            }
            return filtered;
        } catch {
            if (signal?.aborted) throw createAbortError();
            return null;
        }
    }

    private isGraphPprEnabled(): boolean {
        return !this.disposed
            && isB125RetrievalOptimizationPlatformSupported()
            && (
                this.host.isGraphPprEnabled?.()
                ?? this.isRetrievalFlagEnabled("graphPpr")
            );
    }

    private isRetrievalFlagEnabled(
        flag: "strictReranker" | "graphPpr" | "relaxedRecovery",
    ): boolean {
        return resolveB125RetrievalOptimizationFlags(
            this.host.getRetrievalOptimizationFlags?.()
            ?? this.host.settings?.retrievalOptimizationFlags,
        )[flag];
    }

    private beginGraphRankRequest(
        control: RankedPathRequestControl,
        parentSignal?: AbortSignal,
    ): ActiveGraphRankRequest | null {
        if (!this.isGraphPprEnabled() || parentSignal?.aborted) return null;
        const key = `${control.runEpoch}\u0000${control.requestId}`;
        if (this.activeGraphRankRequests.has(key)) return null;
        const request: ActiveGraphRankRequest = {
            key,
            requestId: control.requestId,
            runEpoch: control.runEpoch,
            controller: new AbortController(),
            parentSignal,
            invalidated: false,
        };
        const onParentAbort = () => this.invalidateGraphRankRequest(request);
        if (parentSignal) {
            request.onParentAbort = onParentAbort;
            parentSignal.addEventListener("abort", onParentAbort, { once: true });
        }
        this.activeGraphRankRequests.set(key, request);
        request.unsubscribeSettings = this.host.onSettingsChanged?.(() => {
            if (!this.isGraphPprEnabled()) this.invalidateGraphRankRequest(request);
        });
        if (!this.isGraphPprEnabled() || parentSignal?.aborted) {
            this.invalidateGraphRankRequest(request);
            this.finishGraphRankRequest(request);
            return null;
        }
        return request;
    }

    private isGraphRankRequestCurrent(request: ActiveGraphRankRequest): boolean {
        return !request.invalidated
            && !request.controller.signal.aborted
            && this.activeGraphRankRequests.get(request.key) === request
            && this.isGraphPprEnabled();
    }

    private invalidateGraphRankRequest(request: ActiveGraphRankRequest): void {
        if (request.invalidated) return;
        request.invalidated = true;
        request.unsubscribeSettings?.();
        request.unsubscribeSettings = undefined;
        this.host.memorySearch.cancelGraphCandidateRank(request.requestId, request.runEpoch);
        request.controller.abort();
    }

    private finishGraphRankRequest(request: ActiveGraphRankRequest): void {
        request.unsubscribeSettings?.();
        request.unsubscribeSettings = undefined;
        if (request.parentSignal && request.onParentAbort) {
            request.parentSignal.removeEventListener("abort", request.onParentAbort);
        }
        if (this.activeGraphRankRequests.get(request.key) === request) {
            this.activeGraphRankRequests.delete(request.key);
        }
    }

    private async resolveCurrentRecoveryGenerations(
        rejectedEvidence: ReadonlyMap<string, MemoryRejectedEvidence> | undefined,
        expectedSourceEpoch: string,
        signal?: AbortSignal,
        absoluteDeadlineMs?: number,
    ): Promise<{ coherent: boolean; exactRepeatPaths: Set<string> }> {
        if (!rejectedEvidence || rejectedEvidence.size === 0) {
            return { coherent: true, exactRepeatPaths: new Set() };
        }
        try {
            const result = await this.host.memorySearch.getPathEvidenceGenerations(
                [...rejectedEvidence.keys()],
                {
                    signal,
                    ...(Number.isFinite(absoluteDeadlineMs) ? { absoluteDeadlineMs } : {}),
                },
            );
            throwIfAborted(signal);
            if (result.sourceEpoch !== expectedSourceEpoch) {
                return { coherent: false, exactRepeatPaths: new Set() };
            }
            const exactRepeatPaths = new Set<string>();
            for (const status of result.paths) {
                const rejected = rejectedEvidence.get(status.path);
                if (
                    rejected
                    && status.current
                    && status.generation === rejected.pathEvidenceGeneration
                ) exactRepeatPaths.add(status.path);
            }
            return { coherent: true, exactRepeatPaths };
        } catch {
            if (signal?.aborted) throw createAbortError();
            return { coherent: false, exactRepeatPaths: new Set() };
        }
    }
}

async function settleBeforeAbort<T>(
    task: Promise<T>,
    signal: AbortSignal,
): Promise<
    | { type: "completed"; value: T }
    | { type: "rejected"; error: unknown }
    | { type: "aborted" }
> {
    const tagged = task.then(
        (value) => ({ type: "completed" as const, value }),
        (error) => ({ type: "rejected" as const, error }),
    );
    if (signal.aborted) return { type: "aborted" };
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<{ type: "aborted" }>((resolve) => {
        onAbort = () => resolve({ type: "aborted" });
        signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        return await Promise.race([tagged, aborted]);
    } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
    }
}

function resolveRerankTimeoutMs(
    absoluteDeadlineMs: number | undefined,
    now = Date.now(),
): number {
    const localTimeoutAt = now + RERANK_TIMEOUT_MS;
    const invocationSafeAt = typeof absoluteDeadlineMs === "number" && Number.isFinite(absoluteDeadlineMs)
        ? absoluteDeadlineMs - RERANK_PROJECTION_MARGIN_MS
        : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(localTimeoutAt, invocationSafeAt) - now);
}

function temporalIntentToFilter(intent: QueryTemporalIntent): { since?: number; until?: number } | null {
    const now = Date.now();
    if (intent === "recent_7d") return { since: now - 7 * 24 * 60 * 60 * 1000 };
    if (intent === "recent_30d") return { since: now - 30 * 24 * 60 * 60 * 1000 };
    if (typeof intent === "string" && intent.startsWith("range:")) {
        const match = intent.slice(6).match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
        if (match) {
            const since = Date.parse(match[1]);
            const until = Date.parse(match[2]) + 86400000 - 1;
            if (!isNaN(since) && !isNaN(until)) return { since, until };
        }
    }
    return null;
}

function currentGenerationMap(
    statuses: readonly PathEvidenceGenerationStatus[],
): Map<string, string> {
    const current = new Map<string, string>();
    for (const status of statuses) {
        const path = canonicalMarkdownPath(status.path);
        if (
            path
            && status.current
            && typeof status.generation === "string"
            && status.generation.length > 0
        ) current.set(path, status.generation);
    }
    return current;
}

function freezeLexicalPlan(
    rewritten: RewrittenQuery,
    outerTemporalIntent: QueryTemporalIntent,
): MemoryFrozenLexicalPlan {
    const temporalIntent = outerTemporalIntent !== "none"
        ? outerTemporalIntent
        : rewritten.temporal;
    return {
        ftsQueryOverride: rewritten.keywords,
        temporalIntent,
        temporalFilter: temporalIntentToFilter(temporalIntent),
    };
}

function cloneFrozenLexicalPlan(plan: MemoryFrozenLexicalPlan): MemoryFrozenLexicalPlan {
    return {
        ftsQueryOverride: plan.ftsQueryOverride,
        temporalIntent: plan.temporalIntent,
        temporalFilter: plan.temporalFilter ? { ...plan.temporalFilter } : null,
    };
}

export function parseRerankResponse(content: string, candidates: MemoryCandidate[]): RerankOutcome {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content.trim());
    } catch {
        return createFailOpenOutcome(candidates, "malformed", true);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return createFailOpenOutcome(candidates, "malformed", true);
    }
    const record = parsed as Record<string, unknown>;
    const verdict = record.verdict;
    const ranking = record.ranking;
    const needsMoreEvidence = record.needsMoreEvidence;
    if (
        verdict !== "relevant"
        && verdict !== "partially_relevant"
        && verdict !== "none_relevant"
    ) {
        return createFailOpenOutcome(candidates, "malformed", true);
    }
    if (!Array.isArray(ranking) || typeof needsMoreEvidence !== "boolean") {
        return createFailOpenOutcome(candidates, "malformed", true);
    }
    const indices = ranking as unknown[];
    const unique = new Set<number>();
    for (const value of indices) {
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= candidates.length) {
            return createFailOpenOutcome(candidates, "invalid_index", true);
        }
        if (unique.has(value as number)) {
            return createFailOpenOutcome(candidates, "invalid_index", true);
        }
        unique.add(value as number);
    }
    const rankingIsEmpty = indices.length === 0;
    const contradictory = verdict === "none_relevant"
        ? !rankingIsEmpty || needsMoreEvidence !== true
        : rankingIsEmpty
            || verdict === "relevant" && needsMoreEvidence !== false;
    if (contradictory) {
        return createFailOpenOutcome(candidates, "contradictory", true);
    }
    return {
        kind: "valid",
        verdict,
        needsMoreEvidence,
        candidates: indices.map((index) => candidates[index as number]),
        origin: "model",
        modelCalled: true,
    };
}

function createDeterministicEmptyOutcome(): RerankOutcome {
    return {
        kind: "valid",
        verdict: "none_relevant",
        needsMoreEvidence: true,
        candidates: [],
        origin: "deterministic_empty",
        modelCalled: false,
    };
}

function createFailOpenOutcome(
    candidates: MemoryCandidate[],
    reason: RerankFailOpenReason,
    modelCalled: boolean,
): RerankOutcome {
    return {
        kind: "fail_open",
        verdict: "relevant",
        needsMoreEvidence: false,
        reason,
        candidates,
        origin: "fail_open",
        modelCalled,
    };
}

export function applyRerankOutcome(
    outcome: RerankOutcome,
    boundedInput: MemoryCandidate[],
    strictFilterEnabled: boolean,
): {
    candidates: MemoryCandidate[];
    verdict: RerankOutcome["verdict"];
    needsMoreEvidence: boolean;
} {
    const validNoneRolledBack = outcome.kind === "valid"
        && outcome.verdict === "none_relevant"
        && !strictFilterEnabled;
    return validNoneRolledBack
        ? { candidates: boundedInput, verdict: "relevant", needsMoreEvidence: false }
        : {
            candidates: outcome.candidates,
            verdict: outcome.verdict,
            needsMoreEvidence: outcome.needsMoreEvidence,
        };
}

function createDeterministicEmptyResult(
    query: string,
    recoverySeed?: MemorySearchRecoverySeed,
): MemorySearchResult {
    const rerankOutcome = createDeterministicEmptyOutcome();
    return {
        usedMemory: false,
        query,
        documents: [],
        sources: [],
        candidates: [],
        hasAnswerableContent: false,
        needsSnippetFollowup: false,
        memoryEvidenceState: "none",
        rerankVerdict: "none_relevant",
        needsMoreEvidence: true,
        retrievalGuidance: "No relevant Memory evidence was selected.",
        rerankOutcome,
        ...(recoverySeed ? { recoverySeed } : {}),
    };
}

function createNoRelevantResult(
    query: string,
    rerankOutcome: RerankOutcome,
    recoverySeed?: MemorySearchRecoverySeed,
): MemorySearchResult {
    return {
        usedMemory: false,
        query,
        documents: [],
        sources: [],
        candidates: [],
        hasAnswerableContent: false,
        needsSnippetFollowup: false,
        memoryEvidenceState: "none",
        rerankVerdict: "none_relevant",
        needsMoreEvidence: true,
        retrievalGuidance: "No relevant Memory evidence was selected.",
        rerankOutcome,
        ...(recoverySeed ? { recoverySeed } : {}),
    };
}

function createOperationalUnavailableResult(
    query: string,
    operationalReason: "current_source_unavailable" | "final_source_changed",
    rerankOutcome?: RerankOutcome,
): MemorySearchResult {
    return {
        usedMemory: false,
        query,
        documents: [],
        sources: [],
        candidates: [],
        skipReason: "Memory evidence is currently unavailable.",
        hasAnswerableContent: false,
        needsSnippetFollowup: false,
        memoryEvidenceState: "unavailable",
        rerankVerdict: "relevant",
        needsMoreEvidence: false,
        retrievalGuidance: "Memory evidence is currently unavailable; do not infer note content.",
        operationalReason,
        ...(rerankOutcome ? { rerankOutcome } : {}),
    };
}

function memorySearchUnavailableDiagnosticReason(
    result: MemorySearchResult,
): "source_unavailable" | "source_changed" | undefined {
    if (result.memoryEvidenceState !== "unavailable") return undefined;
    return result.operationalReason === "final_source_changed"
        ? "source_changed"
        : "source_unavailable";
}

function createRecoverySeed(
    query: string,
    lexicalPlan: MemoryFrozenLexicalPlan,
    rejectedEvidence: MemoryRejectedEvidence[],
    queryEmbeddingOut: { value?: number[]; profileSignature?: string; sourceEpoch?: string },
): MemorySearchRecoverySeed {
    const queryEmbedding = queryEmbeddingOut.value && queryEmbeddingOut.profileSignature
        ? {
            value: [...queryEmbeddingOut.value],
            profileSignature: queryEmbeddingOut.profileSignature,
            ...(queryEmbeddingOut.sourceEpoch ? { sourceEpoch: queryEmbeddingOut.sourceEpoch } : {}),
        }
        : undefined;
    return {
        query,
        lexicalPlan: cloneFrozenLexicalPlan(lexicalPlan),
        rejectedEvidence: rejectedEvidence.map(cloneRejectedEvidence),
        ...(queryEmbedding ? { queryEmbedding } : {}),
    };
}

function cloneRecoverySeed(seed: MemorySearchRecoverySeed): MemorySearchRecoverySeed {
    return {
        query: seed.query,
        lexicalPlan: cloneFrozenLexicalPlan(seed.lexicalPlan),
        rejectedEvidence: seed.rejectedEvidence.map(cloneRejectedEvidence),
        ...(seed.queryEmbedding
            ? {
                queryEmbedding: {
                    value: [...seed.queryEmbedding.value],
                    profileSignature: seed.queryEmbedding.profileSignature,
                    ...(seed.queryEmbedding.sourceEpoch
                        ? { sourceEpoch: seed.queryEmbedding.sourceEpoch }
                        : {}),
                },
            }
            : {}),
    };
}

function cloneRejectedEvidence(entry: MemoryRejectedEvidence): MemoryRejectedEvidence {
    return {
        path: entry.path,
        pathEvidenceGeneration: entry.pathEvidenceGeneration,
        evidenceFingerprints: [...entry.evidenceFingerprints],
        ...(entry.origin ? { origin: entry.origin } : {}),
    };
}

function generationRefsFromRejectedEvidence(
    evidence: readonly MemoryRejectedEvidence[],
): PathEvidenceGenerationRef[] {
    const refs = new Map<string, PathEvidenceGenerationRef>();
    for (const entry of evidence) {
        const path = canonicalMarkdownPath(entry.path);
        if (!path || !entry.pathEvidenceGeneration || refs.has(path)) continue;
        refs.set(path, { path, generation: entry.pathEvidenceGeneration });
    }
    return [...refs.values()];
}

function createRejectedEvidenceMap(
    evidence: readonly MemoryRejectedEvidence[],
): ReadonlyMap<string, MemoryRejectedEvidence> {
    const entries = new Map<string, MemoryRejectedEvidence>();
    for (const entry of evidence) {
        const path = canonicalMarkdownPath(entry.path);
        if (!path || entries.has(path)) continue;
        entries.set(path, {
            path,
            pathEvidenceGeneration: entry.pathEvidenceGeneration,
            evidenceFingerprints: [...new Set(entry.evidenceFingerprints)],
            ...(entry.origin ? { origin: entry.origin } : {}),
        });
    }
    return entries;
}

async function createRerankerVisibleEvidenceFingerprint(
    candidate: MemoryCandidate,
    aiUtils: Pick<AIUtils, "hashContent">,
): Promise<string> {
    const path = canonicalMarkdownPath(candidate.path) ?? candidate.path;
    const visible = candidate.documents.map((document) => ({
        path: canonicalMarkdownPath(document.source.path) ?? document.source.path,
        chunkIndex: document.source.chunkIndex ?? null,
        content: document.content,
        contentHash: document.anchorMetadata?.contentHash ?? null,
        startLine: document.anchorMetadata?.startLine ?? null,
        endLine: document.anchorMetadata?.endLine ?? null,
        headingPath: document.anchorMetadata?.headingPath ?? [],
        indexVersion: document.anchorMetadata?.indexVersion ?? null,
    }));
    return aiUtils.hashContent(JSON.stringify({
        path,
        excerpt: candidate.excerpt,
        visible,
        representationVersion: 1,
    }));
}

function createProvisionalSnapshotLimits(absoluteDeadlineMs: number) {
    return {
        maxSnapshotNodes: PROVISIONAL_EC02_GRAPH.maxSnapshotNodes,
        maxSnapshotEdges: PROVISIONAL_EC02_GRAPH.maxSnapshotEdges,
        maxSnapshotBytes: PROVISIONAL_EC02_GRAPH.maxSnapshotBytes,
        absoluteDeadlineMs,
    };
}

function createProvisionalGraphWorkLimits(absoluteDeadlineMs: number): GraphWorkLimits {
    return {
        maxSnapshotNodes: PROVISIONAL_EC02_GRAPH.maxSnapshotNodes,
        maxSnapshotEdges: PROVISIONAL_EC02_GRAPH.maxSnapshotEdges,
        maxSnapshotBytes: PROVISIONAL_EC02_GRAPH.maxSnapshotBytes,
        maxCanonicalNodes: PROVISIONAL_EC02_GRAPH.maxCanonicalNodes,
        maxCanonicalEdges: PROVISIONAL_EC02_GRAPH.maxCanonicalEdges,
        maxLiftedStates: PROVISIONAL_EC02_GRAPH.maxLiftedStates,
        maxLegalTransitions: PROVISIONAL_EC02_GRAPH.maxLegalTransitions,
        maxLocalCandidatePaths: PROVISIONAL_EC02_GRAPH.maxLocalCandidatePaths,
        maxProjectedSolverOperations: PROVISIONAL_EC02_GRAPH.maxProjectedSolverOperations,
        maxProjectedBytes: PROVISIONAL_EC02_GRAPH.maxProjectedBytes,
        absoluteDeadlineMs,
    };
}

function createGraphCandidateFromRankedPath(
    ranked: RankedPathChunks,
    isPathAllowed?: (path: string) => boolean,
): MemoryCandidate | null {
    const path = canonicalMarkdownPath(ranked.path);
    if (!path || isPathAllowed?.(path) === false) return null;
    const normalized = normalizeSearchCandidates(
        ranked.chunks.map((chunk) => ({ score: chunk.score, doc: chunk.doc as RawSearchResult["doc"] })),
        isPathAllowed,
        1,
        Number.NEGATIVE_INFINITY,
    )[0];
    if (!normalized || normalized.path !== path) return null;
    return {
        ...normalized,
        score: ranked.maxScore,
        origin: "graph",
    };
}

function createGraphRequestId(runEpoch?: string): string {
    graphRequestSequence = (graphRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `${runEpoch ?? "memory"}:graph:${Date.now()}:${graphRequestSequence}`;
}

interface LatestSourceMaterializer {
    cleanMarkdown(markdown: string): string;
    hashContent(content: string): Promise<string>;
}

export async function materializeCandidateFromLatestSource(
    candidate: MemoryCandidate,
    source: LatestMemorySourceMaterial,
    materializer: LatestSourceMaterializer,
    requireSameSnapshot = false,
): Promise<MemoryCandidate | null> {
    const candidatePath = canonicalMarkdownPath(candidate.path);
    const sourcePath = canonicalMarkdownPath(source.path);
    if (
        !candidatePath
        || !sourcePath
        || candidatePath !== sourcePath
        || !Number.isFinite(source.mtime)
        || !Number.isFinite(source.size)
        || !hasCompleteCandidateAnchor(candidate, candidatePath)
    ) return null;

    const cleanedMarkdown = materializer.cleanMarkdown(source.markdown);
    if (!cleanedMarkdown.trim()) return null;
    const indexedContentHash = await materializer.hashContent(cleanedMarkdown);
    const bodyHash = await materializer.hashContent(source.markdown);
    const sourceSnapshot = {
        epoch: `${source.mtime}:${source.size}`,
        bodyHash,
    };
    if (
        candidate.anchor?.indexedContentHash !== indexedContentHash
        || requireSameSnapshot && (
            !candidate.sourceSnapshot
            || candidate.sourceSnapshot.epoch !== sourceSnapshot.epoch
            || candidate.sourceSnapshot.bodyHash !== sourceSnapshot.bodyHash
        )
    ) return null;

    const currentChunks = createHeadingAwareMarkdownChunks({
        path: sourcePath,
        markdown: cleanedMarkdown,
        contentHash: indexedContentHash,
        created: source.mtime,
        lastModified: source.mtime,
    });
    const currentByIndex = new Map(currentChunks.map((chunk) => [chunk.chunkIndex, chunk]));
    const documents: MemorySearchDocument[] = [];
    const seenChunks = new Set<number>();
    for (const indexedDocument of candidate.documents.slice(0, MAX_MEMORY_CANDIDATE_CHUNKS)) {
        const chunkIndex = indexedDocument.source.chunkIndex;
        const anchor = indexedDocument.anchorMetadata;
        if (
            !Number.isInteger(chunkIndex)
            || chunkIndex! < 0
            || seenChunks.has(chunkIndex!)
            || canonicalMarkdownPath(indexedDocument.source.path) !== sourcePath
            || !anchor
            || anchor.contentHash !== indexedContentHash
            || !Number.isInteger(anchor.startLine)
            || !Number.isInteger(anchor.endLine)
            || !Array.isArray(anchor.headingPath)
        ) return null;
        const current = currentByIndex.get(chunkIndex!);
        const currentStartLine = current?.metadata.startLine;
        const currentEndLine = current?.metadata.endLine;
        const currentHeadingPath = Array.isArray(current?.metadata.headingPath)
            ? current.metadata.headingPath.filter((entry): entry is string => typeof entry === "string")
            : null;
        if (
            !current
            || truncate(current.content, MAX_MEMORY_CHARS) !== indexedDocument.content
            || typeof currentStartLine !== "number"
            || typeof currentEndLine !== "number"
            || !currentHeadingPath
            || currentStartLine !== anchor.startLine
            || currentEndLine !== anchor.endLine
            || !sameStringArray(currentHeadingPath, anchor.headingPath)
        ) return null;
        seenChunks.add(chunkIndex!);
        documents.push({
            content: truncate(current.content, MAX_MEMORY_CHARS),
            score: indexedDocument.score,
            source: {
                path: sourcePath,
                chunkIndex,
                score: indexedDocument.score,
            },
            anchorMetadata: {
                contentHash: indexedContentHash,
                startLine: currentStartLine,
                endLine: currentEndLine,
                headingPath: [...currentHeadingPath],
                indexVersion: indexedDocument.anchorMetadata?.indexVersion,
            },
        });
    }
    if (documents.length === 0) return null;
    const excerpt = truncate(
        documents.map((document) => document.content).join("\n---\n"),
        MAX_MEMORY_CANDIDATE_EXCERPT_CHARS,
    );
    const anchor = createMemoryCandidateAnchor(candidate.candidateId, documents[0], excerpt);
    return {
        candidateId: candidate.candidateId,
        path: sourcePath,
        score: candidate.score,
        documents,
        excerpt,
        anchor,
        origin: candidate.origin,
        ...(candidate.pathEvidenceGeneration
            ? { pathEvidenceGeneration: candidate.pathEvidenceGeneration }
            : {}),
        sourceSnapshot,
    };
}

function hasCompleteCandidateAnchor(candidate: MemoryCandidate, canonicalPath: string): boolean {
    const anchor = candidate.anchor;
    return Boolean(
        anchor
        && canonicalMarkdownPath(anchor.path) === canonicalPath
        && Number.isInteger(anchor.chunkIndex)
        && anchor.chunkIndex! >= 0
        && typeof anchor.indexedContentHash === "string"
        && anchor.indexedContentHash.length > 0
        && Number.isInteger(anchor.startLine)
        && Number.isInteger(anchor.endLine)
        && Array.isArray(anchor.headingPath)
        && anchor.indexedSnippet === candidate.excerpt,
    );
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalMarkdownPath(path: string): string | null {
    const normalized = normalizeVaultPath(path);
    if (
        !normalized
        || !normalized.toLowerCase().endsWith(".md")
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || normalized.split("/").some((segment) => segment === ".." || segment === "")
    ) return null;
    return normalized;
}

export function admitRerankCandidates(candidates: readonly MemoryCandidate[]): MemoryCandidate[] {
    const direct = candidates.filter((candidate) => candidate.origin !== "graph");
    const graph = candidates
        .filter((candidate) => candidate.origin === "graph")
        .sort(compareGraphCandidateOrder);
    const selected: MemoryCandidate[] = [];
    const seen = new Set<string>();
    const take = (pool: readonly MemoryCandidate[], limit: number) => {
        let count = 0;
        for (const candidate of pool) {
            if (count >= limit) break;
            const normalized = canonicalizeCandidate(candidate);
            if (!normalized || seen.has(normalized.path)) continue;
            seen.add(normalized.path);
            selected.push(normalized);
            count += 1;
        }
    };
    take(direct, MAX_MEMORY_DIRECT_CANDIDATES);
    take(graph, MAX_MEMORY_GRAPH_CANDIDATES);
    return selected.slice(0, MAX_MEMORY_RERANK_CANDIDATES);
}

function compareGraphCandidateOrder(left: MemoryCandidate, right: MemoryCandidate): number {
    const leftScore = Number.isFinite(left.score) ? left.score : Number.NEGATIVE_INFINITY;
    const rightScore = Number.isFinite(right.score) ? right.score : Number.NEGATIVE_INFINITY;
    if (leftScore !== rightScore) return rightScore - leftScore;
    const leftPath = canonicalMarkdownPath(left.path) ?? left.path;
    const rightPath = canonicalMarkdownPath(right.path) ?? right.path;
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
}

function canonicalizeCandidate(candidate: MemoryCandidate): MemoryCandidate | null {
    const path = canonicalMarkdownPath(candidate.path);
    if (!path) return null;
    const documents = candidate.documents
        .map((document): MemorySearchDocument | null => {
            const documentPath = canonicalMarkdownPath(document.source.path);
            if (documentPath !== path) return null;
            const anchorMetadata = document.anchorMetadata
                ? {
                    ...document.anchorMetadata,
                    ...(document.anchorMetadata.headingPath
                        ? { headingPath: [...document.anchorMetadata.headingPath] }
                        : {}),
                }
                : undefined;
            return {
                ...document,
                source: { ...document.source, path },
                ...(anchorMetadata ? { anchorMetadata } : {}),
            };
        })
        .filter((document): document is MemorySearchDocument => document !== null);
    if (documents.length === 0) return null;
    return {
        ...candidate,
        path,
        documents,
        anchor: candidate.anchor ? { ...candidate.anchor, path } : undefined,
    };
}

export function allocateMemoryDocumentsTwoPass(
    candidates: readonly MemoryCandidate[],
    limit = MAX_MEMORY_DOCUMENTS,
): MemorySearchDocument[] {
    const boundedLimit = Math.max(0, Math.min(MAX_MEMORY_DOCUMENTS, Math.floor(limit)));
    const documents: MemorySearchDocument[] = [];
    const seen = new Set<string>();
    const take = (document: MemorySearchDocument | undefined) => {
        if (!document || documents.length >= boundedLimit) return;
        const key = documentDedupKey(document);
        if (seen.has(key)) return;
        seen.add(key);
        documents.push(document);
    };
    for (const candidate of candidates) {
        take(candidate.documents[0]);
        take(candidate.documents[1]);
        if (documents.length >= boundedLimit) return documents;
    }
    for (const candidate of candidates) {
        take(candidate.documents[2]);
        if (documents.length >= boundedLimit) return documents;
    }
    return documents;
}

function sourcesFromDocuments(documents: readonly MemorySearchDocument[]) {
    const seen = new Set<string>();
    return documents.flatMap((document) => {
        const key = documentDedupKey(document);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ ...document.source }];
    });
}

function documentDedupKey(document: MemorySearchDocument): string {
    return `${document.source.path}#${document.source.chunkIndex ?? ""}`;
}

export function normalizeSearchCandidates(
    results: RawSearchResult[],
    isPathAllowed?: (path: string) => boolean,
    maxCandidates = MAX_MEMORY_DIRECT_CANDIDATES,
    minScore = MIN_MEMORY_SCORE,
): MemoryCandidate[] {
    const documents: MemorySearchDocument[] = [];
    const documentCountByPath = new Map<string, number>();
    const generationByPath = new Map<string, string | null>();
    for (const result of results) {
        const metadata = result.doc?.metadata ?? {};
        const path = typeof metadata.path === "string"
            ? canonicalMarkdownPath(metadata.path) ?? ""
            : "";
        if (!path) {
            continue;
        }
        if (isPathAllowed && !isPathAllowed(path)) {
            continue;
        }
        const score = typeof result.score === "number" ? result.score : Number(result.score ?? 0);
        if (!Number.isFinite(score) || score < minScore) continue;
        const pathDocumentCount = documentCountByPath.get(path) ?? 0;
        if (pathDocumentCount >= MAX_MEMORY_CANDIDATE_CHUNKS) continue;
        const chunkIndex = typeof metadata.chunkIndex === "number"
            ? metadata.chunkIndex
            : Number.isFinite(Number(metadata.chunkIndex))
                ? Number(metadata.chunkIndex)
                : undefined;
        const document = {
            content: truncate(stringifyModelContent(result.doc?.pageContent), MAX_MEMORY_CHARS),
            score,
            source: {
                path,
                chunkIndex,
                score,
            },
            anchorMetadata: {
                contentHash: typeof metadata.contentHash === "string" ? metadata.contentHash : undefined,
                startLine: typeof metadata.startLine === "number" ? metadata.startLine : undefined,
                endLine: typeof metadata.endLine === "number" ? metadata.endLine : undefined,
                headingPath: Array.isArray(metadata.headingPath)
                    ? metadata.headingPath.filter((entry): entry is string => typeof entry === "string")
                    : undefined,
                indexVersion: typeof metadata.indexVersion === "string" ? metadata.indexVersion : undefined,
            },
        };
        documents.push(document);
        documentCountByPath.set(path, pathDocumentCount + 1);
        const generation = typeof metadata.pathEvidenceGeneration === "string"
            && metadata.pathEvidenceGeneration.length > 0
            ? metadata.pathEvidenceGeneration
            : undefined;
        const observedGeneration = generationByPath.get(path);
        if (!generationByPath.has(path)) {
            generationByPath.set(path, generation ?? null);
        } else if (observedGeneration !== (generation ?? null)) {
            generationByPath.set(path, null);
        }
    }

    return createMemoryCandidatesFromDocuments(documents, generationByPath)
        .slice(0, Math.max(0, Math.floor(maxCandidates)));
}

function createMemoryCandidatesFromDocuments(
    documents: MemorySearchDocument[],
    generationByPath: ReadonlyMap<string, string | null> = new Map(),
): MemoryCandidate[] {
    const groups = new Map<string, MemorySearchDocument[]>();
    for (const memoryDocument of dedupeDocuments(documents)) {
        const group = groups.get(memoryDocument.source.path) ?? [];
        if (group.length >= MAX_MEMORY_CANDIDATE_CHUNKS) continue;
        group.push(memoryDocument);
        groups.set(memoryDocument.source.path, group);
    }

    return [...groups.entries()]
        .map(([path, group], index) => {
            const score = Math.max(...group.map((memoryDocument) => memoryDocument.score));
            const candidateId = `memory-${index + 1}`;
            const excerpt = truncate(group.map((memoryDocument) => memoryDocument.content).join("\n---\n"), MAX_MEMORY_CANDIDATE_EXCERPT_CHARS);
            const first = group[0];
            const anchor = first ? createMemoryCandidateAnchor(candidateId, first, excerpt) : undefined;
            return {
                candidateId,
                path,
                score,
                documents: group,
                excerpt,
                anchor,
                origin: "direct" as const,
                ...(generationByPath.get(path)
                    ? { pathEvidenceGeneration: generationByPath.get(path)! }
                    : {}),
            };
        })
        .sort((a, b) => b.score - a.score);
}

function createMemoryCandidateAnchor(
    candidateId: string,
    memoryDocument: MemorySearchDocument,
    indexedSnippet: string,
): MemoryCandidateAnchor {
    return {
        candidateId,
        path: memoryDocument.source.path,
        chunkIndex: memoryDocument.source.chunkIndex,
        score: memoryDocument.score,
        indexedSnippet,
        indexedContentHash: memoryDocument.anchorMetadata?.contentHash,
        startLine: memoryDocument.anchorMetadata?.startLine,
        endLine: memoryDocument.anchorMetadata?.endLine,
        headingPath: memoryDocument.anchorMetadata?.headingPath,
        indexVersion: memoryDocument.anchorMetadata?.indexVersion,
    };
}

function filterCandidatesByDataBoundary(
    candidates: MemoryCandidate[],
    isPathAllowed?: (path: string) => boolean,
): MemoryCandidate[] {
    if (!isPathAllowed) return candidates;
    return candidates
        .filter((candidate) => isPathAllowed(candidate.path))
        .map((candidate) => {
            const documents = candidate.documents.filter((document) =>
                isPathAllowed(document.source.path),
            );
            return { ...candidate, documents };
        })
        .filter((candidate) => candidate.documents.length > 0);
}

function filterCandidatesByTemporalRange(
    candidates: readonly MemoryCandidate[],
    temporalFilter: { since?: number; until?: number } | null,
): MemoryCandidate[] {
    if (!temporalFilter) return [...candidates];
    return candidates.filter((candidate) => {
        const mtime = candidateSourceMtime(candidate);
        return mtime !== null && isTimestampWithinTemporalRange(mtime, temporalFilter);
    });
}

function countTemporalRangeViolations(
    candidates: readonly MemoryCandidate[],
    temporalFilter: { since?: number; until?: number } | null,
): number {
    if (!temporalFilter) return 0;
    return candidates.reduce((count, candidate) => {
        const mtime = candidateSourceMtime(candidate);
        return count + (mtime === null || !isTimestampWithinTemporalRange(mtime, temporalFilter) ? 1 : 0);
    }, 0);
}

function candidateSourceMtime(candidate: MemoryCandidate): number | null {
    const epoch = candidate.sourceSnapshot?.epoch;
    if (!epoch) return null;
    const separator = epoch.indexOf(":");
    const value = Number(separator >= 0 ? epoch.slice(0, separator) : epoch);
    return Number.isFinite(value) ? value : null;
}

function isTimestampWithinTemporalRange(
    timestamp: number,
    temporalFilter: { since?: number; until?: number },
): boolean {
    if (!Number.isFinite(timestamp)) return false;
    if (Number.isFinite(temporalFilter.since) && timestamp < temporalFilter.since!) return false;
    if (Number.isFinite(temporalFilter.until) && timestamp > temporalFilter.until!) return false;
    return true;
}

function dedupeDocuments(documents: MemorySearchDocument[]): MemorySearchDocument[] {
    const seen = new Set<string>();
    const deduped: MemorySearchDocument[] = [];
    for (const memoryDocument of documents) {
        const key = `${memoryDocument.source.path}#${memoryDocument.source.chunkIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(memoryDocument);
    }
    return deduped;
}

type ModelContentPart = string | Record<string, unknown>;

function stringifyModelContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map(stringifyModelContentPart).filter(Boolean).join("");
    }
    if (content == null) return "";
    return String(content);
}

function stringifyModelContentPart(part: ModelContentPart): string {
    if (typeof part === "string") return part;
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    if (typeof part.type === "string" && typeof part.value === "string") return part.value;
    return "";
}

function safeRecordDiagnostic(
    record: RetrievalDiagnosticRecorder | undefined,
    event: RetrievalDiagnosticEventInput,
): void {
    try {
        record?.(event);
    } catch {
        // Calibration is observational and must never change retrieval.
    }
}

function isValidInvocationOrdinal(value: number | undefined): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function remainingDeadlineMetric(
    absoluteDeadlineMs: number | undefined,
): Partial<Record<"remainingMs", number>> {
    return Number.isFinite(absoluteDeadlineMs)
        ? { remainingMs: Math.max(0, absoluteDeadlineMs! - Date.now()) }
        : {};
}

function temporalDiagnosticMetrics(
    state: MemorySearchDiagnosticState,
): Partial<Record<"temporalFilterApplied" | "temporalViolationCount", number>> {
    return {
        ...(state.temporalFilterApplied === undefined
            ? {}
            : { temporalFilterApplied: state.temporalFilterApplied }),
        ...(state.temporalViolationCount === undefined
            ? {}
            : { temporalViolationCount: state.temporalViolationCount }),
    };
}

function isDeadlineError(error: unknown): boolean {
    return errorCode(error).includes("deadline") || errorCode(error).includes("timeout");
}

function diagnosticReason(error: unknown): string {
    const code = errorCode(error);
    if (KNOWN_DIAGNOSTIC_ERROR_CODES.has(code)) return code;
    if (code === "query-embedding-override-invalid") return "embedding_unavailable";
    if (code.startsWith("path-evidence-")) return "source_unavailable";
    if (code === "vss-disposed" || code === "sqlite-worker-disposed" || code === "sqlite-db-unavailable") {
        return "request_unavailable";
    }
    if (error instanceof Error && error.name === "AbortError") return "aborted";
    return "unknown_error";
}

const KNOWN_DIAGNOSTIC_ERROR_CODES = new Set([
    "graph-rank-aborted",
    "graph-rank-budget-exceeded",
    "graph-rank-deadline",
    "graph-rank-embedding-invalid",
    "graph-rank-epoch-mismatch",
    "graph-rank-path-evidence-unavailable",
    "graph-rank-path-mismatch",
    "graph-rank-result-invalid",
    "graph-rank-source-changed",
    "graph-rank-source-epoch-mismatch",
    "graph-rank-unavailable",
    "graph-rank-worker-error",
    "timeout",
]);

function errorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const value = (error as { code?: unknown }).code;
    return typeof value === "string" ? value.toLowerCase() : "";
}

export function resolveGraphPreflightDiagnostic(
    localReason?: "aborted" | "deadline" | "local_budget" | "invalid_graph",
    graphReason?: "snapshot_budget" | "graph_budget" | "aborted" | "deadline" | "invalid_graph",
): { outcome: "completed" | "aborted" | "deadline" | "fallback"; reason?: string } {
    const reasons = [localReason, graphReason].filter((reason): reason is NonNullable<typeof reason> => Boolean(reason));
    if (reasons.includes("aborted")) return { outcome: "aborted", reason: "aborted" };
    if (reasons.includes("deadline")) return { outcome: "deadline", reason: "deadline" };
    const reason = localReason ?? graphReason;
    return reason ? { outcome: "fallback", reason } : { outcome: "completed" };
}

export function resolveGraphWorkerFailureOutcome(
    reason: string,
    parentAborted: boolean,
    deadline: boolean,
): "aborted" | "deadline" | "failed" {
    if (parentAborted || reason === "graph-rank-aborted") return "aborted";
    return deadline ? "deadline" : "failed";
}

export function shouldRecordGraphWorkerFailureTerminal(
    reason: string,
    cancelRequestedInRequest: number,
    parentAborted: boolean,
): boolean {
    if (parentAborted || cancelRequestedInRequest <= 0) return true;
    return reason !== "graph-rank-aborted" && reason !== "aborted";
}
