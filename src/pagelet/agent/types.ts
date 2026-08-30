import type {
    AgentCapability,
    AgentRuntimePlatform,
} from "../../ai-services/capability-types";
import type {
    PaAgentLoopResult,
    PaAgentModel,
    PaAgentTurnLeaseProvider,
} from "../../ai-services/pa-agent-loop";
import type { ProviderRequestScope } from "../../ai-services/obsidian-fetch";
import type {
    ChatToolContext,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
    SearchMemoryInput,
} from "../../ai-services/chat-tools";
import type { MemorySearchResult, SourceRecord } from "../../ai-services/chat-types";
import type { CapabilityRegistry } from "../../ai-services/capability-registry";
import type { AiServiceHost } from "../../ai-services/AiServiceHost";

export const PAGELET_DEEP_DISCOVER_PIPELINE_VERSION = "pagelet-deep-discover-v2" as const;
export const PAGELET_DEEP_DISCOVER_MAX_TURNS = 12;
export const PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS = 30;
export const PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS = 180_000;
export const PAGELET_DEEP_DISCOVER_MAX_OBSERVATION_CHARS = 64_000;
export const PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PAGELET_NO_INSIGHT = "NO_INSIGHT" as const;

/**
 * Treat the model's final standalone marker line as a quiet terminal even
 * when it first emitted explanatory Markdown. Inline or non-final mentions
 * remain ordinary content.
 */
export function isPageletNoInsightTerminal(value: string): boolean {
    const lines = value.replace(/\r\n?/g, "\n").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim() ?? "";
        if (!line) continue;
        return line === PAGELET_NO_INSIGHT;
    }
    return false;
}

export type PageletDeepDiscoverTriggerReason =
    | "leave-note"
    | "edit-idle"
    | "open-changed-note"
    | "explicit"
    | string;

export interface PageletAnchorSnapshot {
    path: string;
    content: string;
    mtime: number;
    size: number;
    contentHash: string;
    capturedAt: number;
}

export interface PageletAnchorSnapshotIdentity {
    path: string;
    mtime: number;
    size: number;
    contentHash: string;
}

export interface PageletAgentSourceSnapshot {
    path: string;
    mtime: number;
    size: number;
    contentHash: string;
}

export interface PageletAgentSourceMaterial extends PageletAgentSourceSnapshot {
    content: string;
    capturedAt: number;
}

export interface PageletAgentWebObservation {
    url: string;
    observationHash: string;
}

export interface PageletAgentPolicyIdentity {
    readonly dataBoundaryIdentity: string;
    readonly providerPolicyIdentity: string;
    readonly modelIdentity: string;
    readonly locale: string;
}

/**
 * Content-free proof that source evidence and policy were still current at
 * the controller's synchronous cache/delivery commit point.
 */
export interface PageletDeepDiscoverCommitSeal {
    readonly schemaVersion: 1;
    readonly controllerEpoch: number;
    readonly evidenceEpoch: string;
    readonly policyIdentityKey: string;
}

export interface PageletAgentCacheIdentity extends PageletAgentPolicyIdentity {
    readonly pipelineVersion: typeof PAGELET_DEEP_DISCOVER_PIPELINE_VERSION;
    readonly anchor: PageletAnchorSnapshotIdentity;
    readonly sources: readonly PageletAgentSourceSnapshot[];
}

export interface PageletAgentRunMetrics {
    modelTurns: number;
    toolCalls: number;
    wallTimeMs: number;
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
}

/** Strictly content-free terminal diagnostics for controller and smoke evidence. */
export interface PageletAgentRuntimeCompletion {
    readonly loopStatus: PaAgentLoopResult["status"];
    readonly endReason: string | null;
    readonly diagnosticTypes: readonly string[];
    readonly lastTurnStatus: PaAgentLoopResult["turns"][number]["status"] | null;
    readonly providerStopReason: string | null;
    readonly finalTextState: "empty" | "no-insight" | "candidate";
    readonly citationCoverage:
        | "not-applicable"
        | "complete"
        | "ungrounded"
        | "missing-anchor"
        | "missing-non-anchor";
    readonly turnCount: number;
    readonly toolCallCount: number;
    readonly insightDraftCount: number;
    readonly emptyFinalAnswerRetryCount: 0 | 1;
}

export interface PageletAgentToolProvenance {
    toolName: string;
    sourceRecords: SourceRecord[];
    isError: boolean;
    promptText: string;
}

export interface PageletAgentRunResult {
    loopResult: PaAgentLoopResult;
    finalText: string;
    anchor: PageletAnchorSnapshot;
    sourceSnapshots: PageletAgentSourceSnapshot[];
    sourceTools: ReadonlyMap<string, ReadonlySet<string>>;
    toolProvenance: PageletAgentToolProvenance[];
    webObservations: PageletAgentWebObservation[];
    metrics: PageletAgentRunMetrics;
    runtimeCompletion: PageletAgentRuntimeCompletion;
    /**
     * Host-collected natural-Markdown terminal candidates. The first entry may
     * have been pinned by the Pagelet-only staging control; the second, when
     * present, is the unchanged natural terminal text from the same model run.
     */
    insightDrafts?: readonly PageletAgentInsightDraft[];
    /** Content-free recovery diagnostics; never projected into model input. */
    recovery?: PageletAgentRecoveryDiagnostics;
}

export interface PageletAgentInsightDraft {
    readonly body: string;
    readonly origin: "terminal" | "staged";
    readonly declaredSourceIds: readonly string[];
}

export interface PageletAgentRecoveryDiagnostics {
    readonly enabled: boolean;
    readonly stageControlCalled: boolean;
    readonly relaxedTokenConsumed: boolean;
    readonly relaxedGoal?: "first_insight" | "second_insight";
    /** Content-free classification of the last Host staging validation failure. */
    readonly stageValidationSubreason?: PageletStageValidationSubreason;
}

export type PageletStageValidationSubreason =
    | "shape"
    | "deadline"
    | "failed"
    | "lead"
    | "aborted"
    | PageletAgentQualityRejectReason;

export interface PageletPendingFirstInsight {
    readonly body: string;
    readonly sourceIds: readonly string[];
}

export interface StagePageletInsightInput {
    insightMarkdown: string;
    sourceIds: string[];
    unresolvedLead: {
        leadKey: string;
        supportingSourceIds: string[];
        requestRelaxedRecovery: boolean;
    };
}

export interface PageletAgentModelContext {
    registry: CapabilityRegistry;
    allowedToolNames: ReadonlySet<string>;
    schemas: ChatToolProviderSchema[];
    toolDefinitions: ChatToolRegistryDefinition[];
    anchor: PageletAnchorSnapshot;
    triggerReason: PageletDeepDiscoverTriggerReason;
    signal?: AbortSignal;
    /** Shared by every Provider request in this Pagelet run. */
    providerRequestScope: ProviderRequestScope;
}

export interface PageletAgentRuntimeDependencies {
    host: AiServiceHost;
    createModel(context: PageletAgentModelContext): PaAgentModel;
    executeMemorySearch(
        input: SearchMemoryInput,
        context: ChatToolContext,
        control?: {
            runEpoch: string;
            absoluteDeadlineMs: number;
            providerRequestScope: ProviderRequestScope;
            memoryPreparationOwnerSignal?: AbortSignal;
        },
    ): Promise<MemorySearchResult>;
    revalidateMemorySearch?(
        result: MemorySearchResult,
        signal?: AbortSignal,
    ): Promise<MemorySearchResult>;
    /**
     * Host-only relaxed invocation. The seed owns the frozen query/lexical plan;
     * Pagelet never accepts a model-supplied recovery query or episode handle.
     */
    executeRelaxedMemorySearch?(
        seed: MemorySearchResult,
        context: ChatToolContext,
        goal: "first_insight" | "second_insight",
        control?: {
            runEpoch: string;
            absoluteDeadlineMs: number;
            providerRequestScope: ProviderRequestScope;
            memoryPreparationOwnerSignal?: AbortSignal;
        },
    ): Promise<MemorySearchResult>;
    captureSourceMaterial(
        path: string,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceMaterial | null>;
    isPathAllowed(path: string): boolean;
    webCapabilities?: readonly AgentCapability[];
    runtimePlatform?: AgentRuntimePlatform;
    providerResponseDelivery?: 'incremental' | 'buffered';
    turnLeaseProvider?: PaAgentTurnLeaseProvider;
    now?: () => number;
    createRunId?: () => string;
}

export interface PageletAgentRuntimeRunRequest {
    anchor: PageletAnchorSnapshot;
    triggerReason: PageletDeepDiscoverTriggerReason;
    runId?: string;
    signal?: AbortSignal;
}

export interface PageletAgentRuntime {
    run(request: PageletAgentRuntimeRunRequest): Promise<PageletAgentRunResult>;
}

export interface PageletAgentVerifiedInsight {
    /** Stable per-insight delivery identity; independent from collection state. */
    insightId: string;
    /** Atomic run/cache grouping only; never used as a delivery identity. */
    collectionId: string;
    body: string;
    normalizedBody: string;
    normalizedClaim: string;
    bodyHash: string;
    claimHash: string;
    anchor: PageletAnchorSnapshotIdentity;
    sources: PageletAgentSourceSnapshot[];
    sourceRefs: Array<{ path: string }>;
    cacheIdentity: PageletAgentCacheIdentity;
    cacheIdentityHash: string;
    triggerReason: PageletDeepDiscoverTriggerReason;
    preparedAt: number;
    metrics: PageletAgentRunMetrics;
    webObservations: PageletAgentWebObservation[];
}

export interface PageletAgentVerifiedInsightCollection {
    collectionId: string;
    anchor: PageletAnchorSnapshotIdentity;
    insights: PageletAgentVerifiedInsight[];
    preparedAt: number;
}

/**
 * Content-free local identity retained by Pagelet delivery so a later action
 * or Chat handoff can revalidate the exact verified insight without another
 * provider call.
 */
export interface PageletAgentValidationIdentity {
    readonly cacheIdentity: PageletAgentCacheIdentity;
    readonly cacheIdentityHash: string;
    readonly preparedAt: number;
    readonly webObservations: readonly PageletAgentWebObservation[];
    readonly insightId: string;
    readonly normalizedBody: string;
    readonly normalizedClaim: string;
}

export type PageletAgentQualityRejectReason =
    | "empty"
    | "no-insight"
    | "anchor-not-read"
    | "ungrounded-path"
    | "insufficient-vault-sources"
    | "unsupported-source"
    | "stale-source"
    | "shallow-link"
    | "duplicate"
    | "not-distinct"
    | "bundled-insights"
    | "seen";

export type PageletAgentQualityGateResult =
    | {
        accepted: true;
        body: string;
        normalizedBody: string;
        sources: PageletAgentSourceSnapshot[];
        sourceRefs: Array<{ path: string }>;
    }
    | {
        accepted: false;
        reason: PageletAgentQualityRejectReason;
    };

export type PageletDeepDiscoverControllerResult =
    | {
        status: "verified";
        insight: PageletAgentVerifiedInsight;
        insights: PageletAgentVerifiedInsight[];
        collection: PageletAgentVerifiedInsightCollection;
        commitSeal: PageletDeepDiscoverCommitSeal;
        runtimeCompletion?: PageletAgentRuntimeCompletion;
    }
    | {
        status: "cache-hit";
        insight: PageletAgentVerifiedInsight;
        insights: PageletAgentVerifiedInsight[];
        collection: PageletAgentVerifiedInsightCollection;
        commitSeal: PageletDeepDiscoverCommitSeal;
    }
    | {
        status: "quiet";
        reason: PageletAgentQualityRejectReason | "aborted" | "runtime-incomplete";
        metrics?: PageletAgentRunMetrics;
        runtimeCompletion?: PageletAgentRuntimeCompletion;
    }
    | {
        status: "limit";
        reason: "limit" | "unavailable";
    }
    | {
        status: "denied" | "stale" | "error";
        reason: string;
    };
