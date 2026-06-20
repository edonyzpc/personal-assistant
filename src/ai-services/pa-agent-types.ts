/**
 * Shared type definitions for the PA agent loop, chunk consumer, and tool
 * dispatcher. Extracted to break the circular type-reference between
 * `pa-agent-loop.ts`, `pa-agent-chunk-consumer.ts`, and
 * `pa-agent-tool-dispatcher.ts`.
 *
 * All three modules import from this file; `pa-agent-loop.ts` and
 * `pa-agent-tool-dispatcher.ts` re-export for backward compatibility.
 */

import type { AgentCapabilityExecutionMode } from "./capability-types";
import type { AgentControlSnapshot } from "./pa-agent-control-policy";
import type {
    AgentEndStatus,
    AssistantMessagePart,
    PaToolResultContent,
    ToolExecutionOutcome,
} from "./chat-types";

// ── Types extracted from pa-agent-loop.ts ───────────────────────────

/**
 * Dispatch policy for a buffered tool-call batch (pi hybrid pattern).
 * - "sequential" (default): tools run one at a time, abort/wall-clock short-circuits remaining tools.
 *   Preserved as the default for backward compatibility with the v1 lifecycle plan tests.
 * - "parallel": all tools launch concurrently; abort cancels in-flight tools but each emits a toolResult.
 * - "hybrid": per-tool dispatch via `PaAgentToolExecutor.getExecutionMode`. If any tool in the batch reports
 *   "sequential" the whole batch runs serially; otherwise the batch runs in parallel.
 */
export type PaAgentToolExecutionMode = "sequential" | "parallel" | "hybrid";

export type PaAgentModelStreamChunk =
    | { type: "thinking_delta"; text: string }
    | { type: "text_delta"; text: string }
    | { type: "toolcall_delta"; id?: string; name: string; input?: unknown; argsText?: string; index?: number }
    | { type: "diagnostic"; diagnostic: Record<string, unknown> };

export type PaAgentToolCall = Extract<AssistantMessagePart, { type: "toolCall" }> & {
    id: string;
    index: number;
    rawInputText?: string;
};

export interface PaAgentToolExecutionInput {
    runId: string;
    turnId: string;
    turnIndex: number;
    userInput: string;
    toolCall: PaAgentToolCall;
    signal: AbortSignal;
}

export interface PaAgentToolExecutionResult {
    outcome: ToolExecutionOutcome;
    promptText: string;
    previewText?: string;
    includeInNextPrompt?: boolean;
    sourceRecords?: PaToolResultContent["sourceRecords"];
    contextUsed?: PaToolResultContent["contextUsed"];
    metadata?: Record<string, unknown>;
}

export interface PaAgentToolExecutor {
    execute(input: PaAgentToolExecutionInput): Promise<PaAgentToolExecutionResult>;
    /**
     * Optional hybrid-dispatch lookup. Returns the tool's preferred execution mode (defaults to "parallel"
     * when omitted). When the loop is in "hybrid" mode, any tool returning "sequential" forces the whole
     * batch to run serially.
     */
    getExecutionMode?: (toolName: string) => AgentCapabilityExecutionMode | undefined;
}

export type PaAgentToolMode = "normal" | "final_answer_only";

export type PaAgentAfterTurnDecision =
    | {
        action: "continue";
        reason: "tool_results_ready" | "needs_follow_up" | "corrective_turn";
        runtimeInstruction?: string;
        toolMode?: PaAgentToolMode;
        controlSnapshot?: AgentControlSnapshot;
    }
    | {
        action: "stop";
        status?: AgentEndStatus;
        reason: string;
        warnings?: Array<Record<string, unknown>>;
        diagnostics?: Array<Record<string, unknown>>;
    };

// ── Types extracted from pa-agent-tool-dispatcher.ts ─────────────────

export interface BufferedToolCall {
    key: string;
    id: string;
    name: string;
    index: number;
    argsText: string;
    input?: unknown;
    hasStructuredInput: boolean;
    partIndex: number;
}

export type ParsedBufferedToolCall = PaAgentToolCall & {
    parseError?: string;
};

export type PolicyDecisionRaceResult =
    | { type: "completed"; decision: PaAgentAfterTurnDecision }
    | { type: "rejected"; error: unknown }
    | { type: "aborted" }
    | { type: "wall_clock_exceeded" };
