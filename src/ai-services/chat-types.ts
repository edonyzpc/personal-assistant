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
    | { type: "retrieving"; query: string }
    | { type: "retrieved"; query: string; sources: ChatAgentSource[] }
    | { type: "memory-skipped"; reason: string }
    | { type: "tool-running"; tool: string; message: string }
    | { type: "tool-done"; tool: string; message: string; sources?: ChatAgentSource[] }
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
}

export interface MemorySearchResult {
    usedMemory: boolean;
    query: string;
    documents: MemorySearchDocument[];
    sources: ChatAgentSource[];
    skipReason?: string;
}

export interface AgentPromptPlan {
    hasMemoryContent: boolean;
    allowedMemorySourcePaths: string[];
    chainInput: Record<string, string>;
    usedMemory: boolean;
}

export interface ChatTurnMemoryMetadata {
    hasMemoryContent: boolean;
    allowedMemorySourcePaths: string[];
}

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
    | "read_note_outline";

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
