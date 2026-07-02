import type { PersistedContextTrace } from "../pa/contracts";

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    memoryMetadata?: ChatTurnMemoryMetadata;
    canonicalTurn?: PaAgentPersistedTurn;
    runtimeWarnings?: ChatRuntimeWarning[];
}

export interface ChatRuntimeWarning {
    type: string;
    message?: string;
    detail?: string;
    capability?: string;
    metadata?: Record<string, unknown>;
}

export interface ChatAgentSource {
    path: string;
    chunkIndex?: number;
    score?: number;
}

export type ChatAgentStatus =
    | { type: "thinking" }
    | { type: "memory-prefetching"; query: string }
    | { type: "memory-prefetched"; query: string; sources: ChatAgentSource[] }
    | { type: "memory-reranking"; candidateCount: number }
    | { type: "memory-selected"; sources: ChatAgentSource[]; needsNativeTools?: boolean }
    | { type: "memory-expanded"; sources: ChatAgentSource[]; anchoredCount: number; indexedFallbackCount: number }
    | { type: "retrieving"; query: string }
    | { type: "retrieved"; query: string; sources: ChatAgentSource[] }
    | { type: "memory-skipped"; reason: string }
    | { type: "tool-running"; tool: string; message: string }
    | { type: "tool-done"; tool: string; message: string; sources?: ChatAgentSource[]; availability?: "available" | "partial" | "unavailable" }
    | { type: "tool-skipped"; tool: string; reason: string }
    | { type: "answering" }
    | { type: "fallback"; reason: string };

export type ChatPlannerAction =
    | { action: "answer"; reason: string; useMemory?: boolean }
    | { action: "retrieve"; query: string; reason: string }
    | { action: "tool"; tool: string; input: unknown; reason: string };

export interface MemorySearchDocument {
    content: string;
    score: number;
    source: ChatAgentSource;
    anchorMetadata?: {
        contentHash?: string;
        startLine?: number;
        endLine?: number;
        headingPath?: string[];
        indexVersion?: string;
    };
}

export interface MemoryCandidateAnchor {
    candidateId: string;
    path: string;
    chunkIndex?: number;
    score: number;
    indexedSnippet: string;
    indexedContentHash?: string;
    startLine?: number;
    endLine?: number;
    headingPath?: string[];
    indexVersion?: string;
}

export interface MemoryCandidate {
    candidateId: string;
    path: string;
    score: number;
    documents: MemorySearchDocument[];
    excerpt: string;
    anchor?: MemoryCandidateAnchor;
}

export interface MemorySearchResult {
    usedMemory: boolean;
    query: string;
    documents: MemorySearchDocument[];
    sources: ChatAgentSource[];
    candidates?: MemoryCandidate[];
    skipReason?: string;
    hasAnswerableContent?: boolean;
    needsSnippetFollowup?: boolean;
}

export interface AgentPromptPlan {
    hasMemoryContent: boolean;
    allowedMemorySourcePaths: string[];
    contextUsed: ChatContextUsedItem[];
    chainInput: Record<string, string>;
    usedMemory: boolean;
}

export interface ChatTurnMemoryMetadata {
    hasMemoryContent: boolean;
    allowedMemorySourcePaths: string[];
    contextUsed?: ChatContextUsedItem[];
    sourceRecords?: SourceRecord[];
    contextTrace?: PersistedContextTrace;
}

export type ChatContextUsedCategory =
    | "memory"
    | "current-note"
    | "vault-metadata"
    | "recent-notes"
    | "note-outline"
    | "read-only-tool"
    | "skill-guide"
    | "fallback"
    | "tool-unavailable"
    | "loop-cap";

export interface ChatContextUsedItem {
    category: ChatContextUsedCategory;
    label: string;
    detail?: string;
    sources?: ChatAgentSource[];
    citationEligible?: boolean;
    statusOnly?: boolean;
}

export type SourceRecordKind =
    | "memory-reference"
    | "context-used"
    | "web-source"
    | "skill-guide";

export type SourceRecordBoundary =
    | "memory"
    | "current-note"
    | "read-only-tool"
    | "vault"
    | "web"
    | "skill-context";

export interface SourceRecord {
    kind: SourceRecordKind;
    dedupKey: string;
    turnId?: string;
    providerId?: string;
    capabilityName?: string;
    sourceBoundary?: SourceRecordBoundary;
    title?: string;
    path?: string;
    url?: string;
    snippet?: string;
    score?: number;
    chunkIndex?: number;
    truncated?: boolean;
    redacted?: boolean;
    citationEligible?: boolean;
    statusOnly?: boolean;
    metadata?: Record<string, unknown>;
}

export interface SourceDisplayChip {
    dedupKey: string;
    label: string;
    kinds: SourceRecordKind[];
    citationEligible: boolean;
    records: SourceRecord[];
}

export const RUN_SCOPE_TURN_ID = "__run__";

export type AgentEventScope = "run" | "turn";
export type AgentLifecycleEventType =
    | "agent_start"
    | "turn_start"
    | "message_start"
    | "message_update"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_update"
    | "tool_execution_end"
    | "turn_end"
    | "agent_end";

export type AgentEndStatus =
    | "completed"
    | "completed_with_warning"
    | "incomplete"
    | "aborted"
    | "error";

export type TurnEndStatus =
    | "completed"
    | "tool_results_ready"
    | "completed_with_warning"
    | "incomplete"
    | "aborted"
    | "error";

export type UserMessageContent =
    | string
    | Array<{ type: string; text?: string; metadata?: Record<string, unknown> }>;

export type AssistantMessagePart =
    | { type: "thinking"; text: string }
    | { type: "text"; text: string }
    | { type: "toolCall"; id?: string; name: string; input: unknown; index?: number };

export interface PaToolResultContent {
    promptText: string;
    previewText?: string;
    includeInNextPrompt: boolean;
    sourceRecords?: SourceRecord[];
    contextUsed?: ChatContextUsedItem[];
    metadata?: Record<string, unknown>;
}

export const PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION = 1;

export type PaAgentMessage =
    | {
        role: "user";
        id: string;
        content: UserMessageContent;
        timestamp: number;
    }
    | {
        role: "assistant";
        id: string;
        content: AssistantMessagePart[];
        stopReason?: "stop" | "tool_calls" | "error" | "aborted" | "idle_timeout" | "wall_clock_exceeded";
        timestamp: number;
    }
    | {
        role: "toolResult";
        id: string;
        toolCallId: string;
        toolName: string;
        content: PaToolResultContent;
        isError: boolean;
        timestamp: number;
    };

export interface PaAgentPersistedTurn {
    schemaVersion: typeof PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION;
    runId: string;
    turnId: string;
    status?: TurnEndStatus;
    committedFinalText?: string;
    sourceRecords?: SourceRecord[];
    contextUsed?: ChatContextUsedItem[];
    messages: PaAgentMessage[];
}

export type AgentMessageUpdate =
    | { kind: "thinking_start"; partIndex?: number }
    | { kind: "thinking_delta"; text: string; partIndex?: number }
    | { kind: "thinking_end"; partIndex?: number }
    | { kind: "text_start"; partIndex?: number }
    | { kind: "text_delta"; text: string; partIndex?: number }
    | { kind: "text_end"; partIndex?: number }
    | { kind: "toolcall_start"; toolCallId?: string; name?: string; index?: number }
    | { kind: "toolcall_delta"; text: string; toolCallId?: string; index?: number }
    | { kind: "toolcall_end"; toolCallId?: string; index?: number };

export type ToolExecutionOutcome =
    | "success"
    | "recoverable_error"
    | "schema_invalid"
    | "policy_rejected"
    | "budget_exceeded"
    | "duplicate_skipped"
    | "aborted"
    | "abort_timeout";

export interface AgentEventBase {
    version: 2;
    runId: string;
    turnId: string;
    scope: AgentEventScope;
    seq: number;
    timestamp: number;
    type: AgentLifecycleEventType;
}

export interface AgentStartEvent extends AgentEventBase {
    type: "agent_start";
    scope: "run";
    turnId: typeof RUN_SCOPE_TURN_ID;
    metadata?: Record<string, unknown>;
}

export interface TurnStartEvent extends AgentEventBase {
    type: "turn_start";
    scope: "turn";
    metadata?: Record<string, unknown>;
}

export interface MessageStartEvent extends AgentEventBase {
    type: "message_start";
    scope: "turn";
    message: PaAgentMessage;
    metadata?: Record<string, unknown>;
}

export interface MessageUpdateEvent extends AgentEventBase {
    type: "message_update";
    scope: "turn";
    messageId: string;
    update: AgentMessageUpdate;
    metadata?: Record<string, unknown>;
}

export interface MessageEndEvent extends AgentEventBase {
    type: "message_end";
    scope: "turn";
    message: PaAgentMessage;
    metadata?: Record<string, unknown>;
}

export interface ToolExecutionStartEvent extends AgentEventBase {
    type: "tool_execution_start";
    scope: "turn";
    toolCallId: string;
    toolName: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
}

export interface ToolExecutionUpdateEvent extends AgentEventBase {
    type: "tool_execution_update";
    scope: "turn";
    toolCallId: string;
    toolName: string;
    metadata?: Record<string, unknown>;
}

export interface ToolExecutionEndEvent extends AgentEventBase {
    type: "tool_execution_end";
    scope: "turn";
    toolCallId: string;
    toolName: string;
    outcome: ToolExecutionOutcome;
    metadata?: Record<string, unknown>;
}

export interface TurnEndEvent extends AgentEventBase {
    type: "turn_end";
    scope: "turn";
    status: TurnEndStatus;
    toolResults?: Array<Extract<PaAgentMessage, { role: "toolResult" }>>;
    metadata?: Record<string, unknown>;
}

export interface AgentEndEvent extends AgentEventBase {
    type: "agent_end";
    scope: "run";
    turnId: typeof RUN_SCOPE_TURN_ID;
    status: AgentEndStatus;
    metadata?: { finalTurnId?: string } & Record<string, unknown>;
}

export type AgentEvent =
    | AgentStartEvent
    | TurnStartEvent
    | MessageStartEvent
    | MessageUpdateEvent
    | MessageEndEvent
    | ToolExecutionStartEvent
    | ToolExecutionUpdateEvent
    | ToolExecutionEndEvent
    | TurnEndEvent
    | AgentEndEvent;

export type AgentActivityType =
    | "loop-start"
    | "memory-prefetching"
    | "memory-prefetched"
    | "memory-reranking"
    | "memory-selected"
    | "memory-expanded"
    | "tool-running"
    | "tool-done"
    | "tool-skipped"
    | "context-used"
    | "answering"
    | "fallback-tool-disabled"
    | "fallback-stream-invoke"
    | "partial-output-error"
    | "guardrail-stopped";

export interface LegacyAgentEventBase {
    version: 1;
    turnId: string;
    seq: number;
    timestamp: number;
}

export interface LegacyAgentActivityEvent extends LegacyAgentEventBase {
    kind: "activity";
    type: AgentActivityType;
    summary: string;
    detail?: Record<string, unknown>;
}

export interface LegacyAgentAnswerStartedEvent extends LegacyAgentEventBase {
    kind: "answer-started";
}

export interface LegacyAgentAnswerSnapshotEvent extends LegacyAgentEventBase {
    kind: "answer-snapshot";
    snapshot: string;
}

export interface LegacyAgentReasoningChunkEvent extends LegacyAgentEventBase {
    kind: "reasoning-chunk";
    chunk: string;
}

export interface LegacyAgentTurnMetadataEvent extends LegacyAgentEventBase {
    kind: "turn-metadata";
    metadata: ChatTurnMemoryMetadata;
}

export type LegacyAgentTerminalEvent =
    | (LegacyAgentEventBase & { kind: "answer-complete" })
    | (LegacyAgentEventBase & { kind: "partial-output-error"; category: string })
    | (LegacyAgentEventBase & { kind: "aborted" });

export type LegacyAgentEvent =
    | LegacyAgentActivityEvent
    | LegacyAgentAnswerStartedEvent
    | LegacyAgentAnswerSnapshotEvent
    | LegacyAgentReasoningChunkEvent
    | LegacyAgentTurnMetadataEvent
    | LegacyAgentTerminalEvent;

export type VaultAdviceEvidenceKind =
    | "explicit_rule"
    | "template_or_workflow"
    | "fact_context"
    | "insufficient_evidence";

export interface VaultAdviceEvidence {
    kind: VaultAdviceEvidenceKind;
    tool: string;
    path?: string;
    reason: string;
    excerpt?: string;
}

export interface VaultAdviceContext {
    applies: boolean;
    evidence: VaultAdviceEvidence[];
}

export interface AgentTurnPlan {
    finalAnswer: AgentPromptPlan;
    vaultAdviceContext?: VaultAdviceContext;
}

export type ChatAgentIntent = "content-seeking" | "agent-control";

export type ChatToolName =
    | "search_memory"
    | "get_current_note_context"
    | "search_vault_metadata"
    | "list_recent_notes"
    | "read_note_outline"
    | "inspect_obsidian_note"
    | "read_canvas_summary"
    | "search_vault_snippets"
    | "list_vault_tags"
    | "webSearch"
    | "load_skill";

export interface ChatToolResult<Output> {
    ok: boolean;
    tool: string;
    inputSummary: string;
    content: Output | null;
    sources: ChatAgentSource[];
    sourceRecords?: SourceRecord[];
    error?: string;
}

export type ChatContextKind = "memory" | "current-note" | "tool-note" | "skill-guide";

export interface ChatContextItem {
    kind: ChatContextKind;
    tool: string;
    content: string;
    sources: ChatAgentSource[];
    score?: number;
    metadata?: Record<string, unknown>;
}
