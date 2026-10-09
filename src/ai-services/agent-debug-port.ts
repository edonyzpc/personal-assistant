/** Chat-scoped, optional observation port. It never owns execution or cancellation. */
import type { PaAgentRunUsageLedger } from './agent-usage-ledger';
export type AgentDebugDomain =
    | "vault_notes" | "personal_memory" | "insights" | "legacy_memory" | "chat_history";

export interface AgentDebugLineage {
    sourcePaths?: readonly string[];
    claimIds?: readonly string[];
    legacyRecordIds?: readonly string[];
    domains?: readonly AgentDebugDomain[];
    unknown?: boolean;
}

export interface AgentDebugUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    reasoningTokens?: number;
    complete?: boolean;
    source?: string;
    /** Repeated cumulative updates replace rather than add to the same call. */
    updateKey?: string;
    aggregation?: "cumulative" | "delta";
}

/** Existing attachment identity only. Debug never owns or reads media bytes. */
export interface AgentDebugAttachment {
    kind: "image";
    assetId: string;
    contentHash: string;
    ordinal?: number;
    mime?: string;
    width?: number;
    height?: number;
    byteLength?: number;
    variantHash?: string;
    processorVersion?: number;
    policyFingerprint?: string;
    availability: "provided" | "unknown";
}

export type AgentDebugNodeKind = "run" | "turn" | "phase" | "llm" | "attempt" | "tool";
export type AgentDebugNodeStatus =
    | "queued" | "running" | "waiting" | "completed" | "partial"
    | "failed" | "cancelled" | "interrupted" | "unknown";

/** Raw values are admitted only to the collector's dedicated safe projections. */
export interface AgentDebugObservation {
    nodeId: string;
    parentId?: string;
    kind: AgentDebugNodeKind;
    phase: string;
    /** Real execution boundary, independent of status or payload arrival. */
    boundary?: "start" | "update" | "end" | "instant";
    /** A tool's executed result is distinct from its later model-context text. */
    contentRole?: "actual_tool_result" | "model_tool_observation";
    purpose?: "answer" | "context_summary" | "query_rewrite" | "rerank" | "image_preparation" | "ghost_metadata";
    status?: AgentDebugNodeStatus;
    runtimeRunId?: string;
    turnId?: string;
    toolCallId?: string;
    callId?: string;
    attemptId?: string;
    provider?: string;
    model?: string;
    toolName?: string;
    transport?: "native" | "buffered";
    /** Body / explicit plan, as opposed to provider reasoning. */
    text?: string;
    textMode?: "delta" | "replace";
    /** Final admitted request body, never credentials/headers or Request streams. */
    prompt?: unknown;
    attachments?: readonly AgentDebugAttachment[];
    /** Actual tool parameters and results, independently of later prompt projection. */
    toolInput?: unknown;
    toolOutput?: unknown;
    reasoning?: string;
    usage?: AgentDebugUsage;
    error?: { name?: string; message?: string; code?: string; stack?: string };
    outcome?: string;
    missingReason?: string;
    lineage?: AgentDebugLineage;
    /** Selected major-phase duration; detailed performance probes are not always-on fields. */
    durationMs?: number;
    /** Milliseconds relative to the same monotonic clock, not inferred pixel timing. */
    timing?: { event: "dispatch" | "response" | "first_model_content" | "first_provider_text"
        | "first_chat_text_committed" | "provider_completion" | "consumer_end"; at: number };
}

export interface AgentDebugRunRecorder {
    readonly captureId: string;
    enabled(): boolean;
    bindRun(runtimeRunId: string): void;
    observe(event: AgentDebugObservation): void;
    finish(status: AgentDebugNodeStatus, error?: AgentDebugObservation["error"]): void;
}

export interface AgentDebugPort {
    startRun(input: { conversationId?: string; prompt: string; provider: string; model: string }): AgentDebugRunRecorder;
}

/** Explicit ownership of one logical model call; never part of provider input. */
export interface AgentDebugCallScope {
    recorder: AgentDebugRunRecorder;
    /** Run-local accounting remains active when Debug capture is disabled. */
    usageLedger?: PaAgentRunUsageLedger;
    /** Budget estimate for the input currently bound to the next physical dispatch. */
    promptEstimate?: { tokens: number; method: string };
    callId: string;
    parentId: string;
    turnId?: string;
    purpose: "answer" | "context_summary" | "query_rewrite" | "rerank" | "image_preparation" | "ghost_metadata";
    provider?: string;
    model?: string;
    lineage?: AgentDebugLineage;
    /** Read existing metadata at dispatch, only after the dynamic capture gate. */
    getAttachments?: () => readonly AgentDebugAttachment[];
}

/** Observer defects must not alter provider, tool or Agent outcomes. */
export function observeAgentDebug(
    recorder: AgentDebugRunRecorder | undefined,
    event: AgentDebugObservation | (() => AgentDebugObservation),
): void {
    try {
        if (recorder?.enabled()) recorder.observe(typeof event === "function" ? event() : event);
    } catch { /* Debug is best effort, never a second execution path. */ }
}
