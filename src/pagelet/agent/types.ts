import type {
    AgentCapability,
    AgentRuntimePlatform,
} from "../../ai-services/capability-types";
import type {
    PaAgentLoopResult,
    PaAgentModel,
    PaAgentTurnLeaseProvider,
} from "../../ai-services/pa-agent-loop";
import type {
    ChatToolContext,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
    SearchMemoryInput,
} from "../../ai-services/chat-tools";
import type { MemorySearchResult, SourceRecord } from "../../ai-services/chat-types";
import type { CapabilityRegistry } from "../../ai-services/capability-registry";
import type { AiServiceHost } from "../../ai-services/AiServiceHost";

export const PAGELET_DEEP_DISCOVER_PIPELINE_VERSION = "pagelet-deep-discover-v1" as const;
export const PAGELET_DEEP_DISCOVER_MAX_TURNS = 12;
export const PAGELET_DEEP_DISCOVER_MAX_TOOL_CALLS = 30;
export const PAGELET_DEEP_DISCOVER_MAX_WALL_CLOCK_MS = 180_000;
export const PAGELET_DEEP_DISCOVER_MAX_OBSERVATION_CHARS = 64_000;
export const PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PAGELET_NO_INSIGHT = "NO_INSIGHT" as const;

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
}

export interface PageletAgentModelContext {
    registry: CapabilityRegistry;
    allowedToolNames: ReadonlySet<string>;
    schemas: ChatToolProviderSchema[];
    toolDefinitions: ChatToolRegistryDefinition[];
    anchor: PageletAnchorSnapshot;
    triggerReason: PageletDeepDiscoverTriggerReason;
    signal?: AbortSignal;
}

export interface PageletAgentRuntimeDependencies {
    host: AiServiceHost;
    createModel(context: PageletAgentModelContext): PaAgentModel;
    executeMemorySearch(
        input: SearchMemoryInput,
        context: ChatToolContext,
    ): Promise<MemorySearchResult>;
    captureSourceMaterial(
        path: string,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceMaterial | null>;
    isPathAllowed(path: string): boolean;
    webCapabilities?: readonly AgentCapability[];
    runtimePlatform?: AgentRuntimePlatform;
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
    body: string;
    normalizedBody: string;
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
    }
    | {
        status: "cache-hit";
        insight: PageletAgentVerifiedInsight;
    }
    | {
        status: "quiet";
        reason: PageletAgentQualityRejectReason | "aborted" | "runtime-incomplete";
        metrics?: PageletAgentRunMetrics;
    }
    | {
        status: "limit";
        reason: "limit" | "unavailable";
    }
    | {
        status: "denied" | "stale" | "error";
        reason: string;
    };
