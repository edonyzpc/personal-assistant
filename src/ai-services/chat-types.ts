export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
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
    | { type: "web-search-enabled" }
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
}

export type ChatContextUsedCategory =
    | "memory"
    | "current-note"
    | "vault-metadata"
    | "recent-notes"
    | "note-outline"
    | "read-only-tool"
    | "provider-web"
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
    | "web-search-enabled"
    | "answering"
    | "fallback-tool-disabled"
    | "partial-output-error"
    | "guardrail-stopped";

export interface AgentEventBase {
    turnId: string;
    seq: number;
    timestamp: number;
}

export interface AgentActivityEvent extends AgentEventBase {
    kind: "activity";
    type: AgentActivityType;
    summary: string;
    detail?: Record<string, unknown>;
}

export interface AgentAnswerStartedEvent extends AgentEventBase {
    kind: "answer-started";
}

export interface AgentAnswerSnapshotEvent extends AgentEventBase {
    kind: "answer-snapshot";
    snapshot: string;
}

export interface AgentReasoningChunkEvent extends AgentEventBase {
    kind: "reasoning-chunk";
    chunk: string;
}

export interface AgentTurnMetadataEvent extends AgentEventBase {
    kind: "turn-metadata";
    metadata: ChatTurnMemoryMetadata;
}

export type AgentTerminalEvent =
    | (AgentEventBase & { kind: "answer-complete" })
    | (AgentEventBase & { kind: "partial-output-error"; category: string })
    | (AgentEventBase & { kind: "aborted" });

export type AgentEvent =
    | AgentActivityEvent
    | AgentAnswerStartedEvent
    | AgentAnswerSnapshotEvent
    | AgentReasoningChunkEvent
    | AgentTurnMetadataEvent
    | AgentTerminalEvent;

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
    | "list_vault_tags";

export interface ChatToolResult<Output> {
    ok: boolean;
    tool: string;
    inputSummary: string;
    content: Output | null;
    sources: ChatAgentSource[];
    error?: string;
}

export type ChatContextKind = "memory" | "current-note" | "tool-note";

export interface ChatContextItem {
    kind: ChatContextKind;
    tool: string;
    content: string;
    sources: ChatAgentSource[];
    score?: number;
    metadata?: Record<string, unknown>;
}
