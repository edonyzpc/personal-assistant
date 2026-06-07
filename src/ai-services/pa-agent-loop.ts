import {
    AgentLifecycleEventEmitter,
} from "./agent-runtime-primitives";
import { errorMessage, stableStringify } from "./agent-utils";
import type { AgentCapabilityExecutionMode } from "./capability-types";
import {
    deriveContinuedAgentControlSnapshot,
    summarizeAgentControlSnapshot,
    toolConstraintsFromAgentControlSnapshot,
    type AgentControlSnapshot,
} from "./pa-agent-control-policy";
import type {
    AgentEndStatus,
    AgentEvent,
    AssistantMessagePart,
    PaAgentMessage,
    PaToolResultContent,
    ToolExecutionOutcome,
    TurnEndStatus,
    UserMessageContent,
} from "./chat-types";

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

export interface PaAgentModelInput {
    runId: string;
    turnId: string;
    turnIndex: number;
    userInput: string;
    transcript: PaAgentMessage[];
    hostContext?: Record<string, unknown>;
    runtimeInstruction?: string;
    toolMode?: PaAgentToolMode;
    controlSnapshot?: AgentControlSnapshot;
}

export interface PaAgentModel {
    stream(input: PaAgentModelInput): AsyncIterable<PaAgentModelStreamChunk>;
}

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
    getExecutionMode?(toolName: string): AgentCapabilityExecutionMode | undefined;
}

export type PaAgentToolMode = "normal" | "final_answer_only";

export interface PaAgentTimingEntry {
    phase: string;
    elapsedMs: number;
    metadata?: Record<string, unknown>;
}

export interface PaAgentTurnToolOutcome {
    toolName: string;
    outcome?: string;
    reason?: string;
    isError: boolean;
    includeInNextPrompt: boolean;
    executionElapsedMs?: number;
}

export interface PaAgentTurnTiming {
    turnIndex: number;
    status: TurnEndStatus;
    elapsedMs: number;
    modelElapsedMs: number;
    firstModelChunkElapsedMs?: number;
    modelChunkCount: number;
    toolCallCount: number;
    toolResultCount: number;
    toolExecutionElapsedMs?: number;
    toolNames?: string[];
    executorInvokedToolNames?: string[];
    preflightSkippedToolNames?: string[];
    toolOutcomes?: PaAgentTurnToolOutcome[];
}

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

export interface PaAgentTurnSummary {
    turnId: string;
    turnIndex: number;
    status: TurnEndStatus;
    assistantMessage: PaAgentMessage;
    committedFinalText: string;
    pendingTextReclassified: boolean;
    toolCalls: AssistantMessagePart[];
    toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>>;
    diagnostics: Array<Record<string, unknown>>;
    metrics: Array<Record<string, unknown>>;
    timing: PaAgentTurnTiming;
    controlSnapshot?: AgentControlSnapshot;
}

export interface PaAgentHostPolicy {
    afterTurn(summary: PaAgentTurnSummary): PaAgentAfterTurnDecision | Promise<PaAgentAfterTurnDecision>;
}

export interface PaAgentLoopOptions {
    runId: string;
    userInput: string;
    userMessageContent?: UserMessageContent;
    model: PaAgentModel;
    toolExecutor?: PaAgentToolExecutor;
    hostPolicy?: PaAgentHostPolicy;
    now?: () => number;
    createId?: (prefix: string) => string;
    onEvent?: (event: AgentEvent) => void;
    onCommittedFinalText?: (snapshot: string) => void;
    hostContext?: Record<string, unknown>;
    initialRuntimeInstruction?: string;
    initialControlSnapshot?: AgentControlSnapshot;
    maxTurns?: number;
    maxToolCalls?: number;
    maxObservationChars?: number;
    assistantIdleTimeoutMs?: number;
    maxWallClockMs?: number;
    toolTimeoutMs?: number;
    toolTimeoutOutcome?: ToolExecutionOutcome;
    toolAbortGraceMs?: number;
    /**
     * Dispatch policy for buffered tool calls (pi hybrid pattern). Default is "sequential" for backward
     * compatibility with v1 lifecycle assumptions; the production runtime (pa-agent-runtime.ts) opts into
     * "hybrid" so read-only tools execute concurrently.
     */
    toolExecutionMode?: PaAgentToolExecutionMode;
    startupTimings?: readonly PaAgentTimingEntry[];
    signal?: AbortSignal;
}

export interface PaAgentLoopResult {
    status: AgentEndStatus;
    transcript: PaAgentMessage[];
    committedFinalText: string;
    turns: PaAgentTurnSummary[];
    /**
     * Mirrors the final `agent_end` event payload (reason + any diagnostics/warnings/max* limits).
     * Always populated when the loop returns normally. Callers that re-throw on a non-success status
     * (e.g., the canonical runtime on `status === "error"`) should JSON.stringify this into the Error
     * message so loop diagnostics survive past the event stream and reach upstream logs.
     */
    endPayload?: Record<string, unknown>;
}

export class PaAgentLoop {
    private readonly events: AgentLifecycleEventEmitter;
    private readonly now: () => number;
    private readonly createId: (prefix: string) => string;
    private readonly maxTurns: number;
    private readonly maxToolCalls: number;
    private readonly maxObservationChars: number;
    private readonly assistantIdleTimeoutMs: number;
    private readonly maxWallClockMs: number;
    private readonly toolTimeoutMs: number;
    private readonly toolTimeoutOutcome: ToolExecutionOutcome;
    private readonly toolAbortGraceMs: number;
    private readonly runStartedAt: number;
    private readonly startupTimings: readonly PaAgentTimingEntry[];
    private readonly transcript: PaAgentMessage[] = [];
    private readonly turns: PaAgentTurnSummary[] = [];
    private readonly seenToolCallKeys = new Set<string>();
    private committedFinalText = "";
    private toolCallCount = 0;
    private remainingObservationChars: number;
    private endPayload?: Record<string, unknown>;
    private currentTurnToolMode: PaAgentToolMode | undefined;
    private currentTurnControlSnapshot: AgentControlSnapshot | undefined;

    constructor(private readonly options: PaAgentLoopOptions) {
        this.now = options.now ?? Date.now;
        this.createId = options.createId ?? createIncrementingIdFactory();
        this.maxTurns = options.maxTurns ?? 20;
        this.maxToolCalls = options.maxToolCalls ?? 30;
        this.maxObservationChars = options.maxObservationChars ?? 24_000;
        this.remainingObservationChars = this.maxObservationChars;
        this.assistantIdleTimeoutMs = options.assistantIdleTimeoutMs ?? 60_000;
        this.maxWallClockMs = options.maxWallClockMs ?? 180_000;
        this.toolTimeoutMs = options.toolTimeoutMs ?? 30_000;
        this.toolTimeoutOutcome = options.toolTimeoutOutcome ?? "recoverable_error";
        this.toolAbortGraceMs = options.toolAbortGraceMs ?? 2_000;
        this.runStartedAt = this.now();
        this.startupTimings = options.startupTimings ?? [];
        this.events = new AgentLifecycleEventEmitter({
            runId: options.runId,
            now: this.now,
            onEvent: options.onEvent,
        });
    }

    async run(): Promise<PaAgentLoopResult> {
        this.events.agentStart(this.startupTimings.length > 0
            ? { timing: { startup: this.startupTimings } }
            : undefined);

        let nextRuntimeInstruction = this.options.initialRuntimeInstruction;
        let nextToolMode: PaAgentToolMode | undefined;
        let nextControlSnapshot = this.options.initialControlSnapshot;
        for (let turnIndex = 0; turnIndex < this.maxTurns; turnIndex++) {
            if (this.isAborted()) {
                this.endAgent("aborted", { reason: "user_abort" });
                return this.createResult("aborted");
            }
            if (this.isWallClockExceeded()) {
                this.endAgent("incomplete", {
                    reason: "wall_clock_exceeded",
                    maxWallClockMs: this.maxWallClockMs,
                });
                return this.createResult("incomplete");
            }

            const turnSummary = await this.runTurn(
                turnIndex,
                nextRuntimeInstruction,
                nextToolMode,
                nextControlSnapshot,
            );
            this.turns.push(turnSummary);
            nextRuntimeInstruction = undefined;
            nextToolMode = undefined;
            nextControlSnapshot = undefined;

            if (turnSummary.status === "aborted" || turnSummary.status === "error") {
                const status = this.agentStatusFromTurn(turnSummary.status);
                this.endAgent(status, {
                    reason: turnSummary.status,
                    diagnostics: turnSummary.diagnostics,
                });
                return this.createResult(status);
            }

            const decision = await this.decideAfterTurn(turnSummary);
            if (decision.action === "continue") {
                nextRuntimeInstruction = decision.runtimeInstruction;
                nextToolMode = decision.toolMode;
                nextControlSnapshot = decision.controlSnapshot
                    ?? deriveContinuedAgentControlSnapshot(turnSummary.controlSnapshot, {
                        runtimeInstruction: decision.runtimeInstruction,
                        toolMode: decision.toolMode,
                    });
                continue;
            }

            const status = decision.status ?? this.agentStatusFromTurn(turnSummary.status);
            const diagnostics = decision.diagnostics
                ?? (turnSummary.diagnostics.length > 0 ? turnSummary.diagnostics : undefined);
            this.endAgent(status, {
                reason: decision.reason,
                ...(decision.warnings ? { warnings: decision.warnings } : {}),
                ...(diagnostics ? { diagnostics } : {}),
            });
            return this.createResult(status);
        }

        this.endAgent("incomplete", {
            reason: "max_turns_exceeded",
            maxTurns: this.maxTurns,
        });
        return this.createResult("incomplete");
    }

    private async runTurn(
        turnIndex: number,
        runtimeInstruction?: string,
        toolMode?: PaAgentToolMode,
        controlSnapshot?: AgentControlSnapshot,
    ): Promise<PaAgentTurnSummary> {
        const turnStartedAt = this.now();
        this.currentTurnToolMode = toolMode;
        this.currentTurnControlSnapshot = controlSnapshot;
        const turnId = this.createId("turn");
        this.events.turnStart(turnId, {
            turnIndex,
            ...(this.options.hostContext ? { hostContext: this.options.hostContext } : {}),
            ...(runtimeInstruction ? { runtimeInstruction } : {}),
            ...(toolMode ? { toolMode } : {}),
            ...(controlSnapshot ? { controlSnapshot: summarizeAgentControlSnapshot(controlSnapshot) } : {}),
        });

        if (turnIndex === 0) {
            const userMessage = this.createUserMessage();
            this.events.messageStart(turnId, userMessage);
            this.events.messageEnd(turnId, userMessage);
            this.transcript.push(userMessage);
        }

        const assistantMessage: PaAgentMessage = {
            role: "assistant",
            id: this.createId("message_assistant"),
            content: [],
            timestamp: this.now(),
        };
        this.events.messageStart(turnId, assistantMessage);

        let sawThinking = false;
        let sawText = false;
        let sawToolCall = false;
        let pendingText = "";
        let pendingTextReclassified = false;
        const toolCallBuffers: BufferedToolCall[] = [];
        const modelStartedAt = this.now();
        let firstModelChunkElapsedMs: number | undefined;
        let modelChunkCount = 0;

        const modelInput = {
            runId: this.options.runId,
            turnId,
            turnIndex,
            userInput: this.options.userInput,
            transcript: [...this.transcript],
            ...(this.options.hostContext ? { hostContext: this.options.hostContext } : {}),
            runtimeInstruction,
            toolMode,
            controlSnapshot,
        };
        let terminalStatus: TurnEndStatus | undefined;
        let stopReason: "stop" | "tool_calls" | "error" | "aborted" | "idle_timeout" | "wall_clock_exceeded" | undefined;
        const diagnostics: Array<Record<string, unknown>> = [];
        const metrics: Array<Record<string, unknown>> = [];

        let iterator: AsyncIterator<PaAgentModelStreamChunk> | undefined;
        try {
            iterator = this.options.model.stream(modelInput)[Symbol.asyncIterator]();
        } catch (error) {
            stopReason = "error";
            terminalStatus = "error";
            diagnostics.push(providerErrorDiagnostic(error));
        }

        while (iterator) {
            const next = await this.nextModelChunk(iterator);
            if (next.type === "done") {
                break;
            }
            if (next.type === "idle") {
                stopReason = "idle_timeout";
                terminalStatus = pendingText.length > 0 ? "completed_with_warning" : "incomplete";
                diagnostics.push({ type: "assistant_idle_timeout", timeoutMs: this.assistantIdleTimeoutMs });
                break;
            }
            if (next.type === "aborted") {
                stopReason = "aborted";
                terminalStatus = "aborted";
                diagnostics.push({ type: "user_abort" });
                break;
            }
            if (next.type === "wall_clock_exceeded") {
                stopReason = "wall_clock_exceeded";
                terminalStatus = pendingText.length > 0 ? "completed_with_warning" : "incomplete";
                diagnostics.push({ type: "wall_clock_exceeded", maxWallClockMs: this.maxWallClockMs });
                break;
            }
            if (next.type === "error") {
                stopReason = "error";
                terminalStatus = pendingText.length > 0 ? "completed_with_warning" : "error";
                diagnostics.push(providerErrorDiagnostic(next.error));
                break;
            }

            const chunk = next.chunk;
            if (chunk.type === "diagnostic") {
                metrics.push(chunk.diagnostic);
                continue;
            }
            modelChunkCount += 1;
            if (firstModelChunkElapsedMs === undefined) {
                firstModelChunkElapsedMs = elapsedSince(modelStartedAt, this.now());
            }
            switch (chunk.type) {
                case "thinking_delta":
                    if (!sawThinking) {
                        sawThinking = true;
                        this.events.messageUpdate(turnId, assistantMessage.id, { kind: "thinking_start" });
                    }
                    appendTextPart(assistantMessage.content, "thinking", chunk.text);
                    this.events.messageUpdate(turnId, assistantMessage.id, { kind: "thinking_delta", text: chunk.text });
                    break;
                case "text_delta":
                    if (!sawText) {
                        sawText = true;
                        this.events.messageUpdate(turnId, assistantMessage.id, { kind: "text_start" });
                    }
                    pendingText += chunk.text;
                    appendTextPart(assistantMessage.content, sawToolCall ? "thinking" : "text", chunk.text);
                    this.events.messageUpdate(turnId, assistantMessage.id, { kind: "text_delta", text: chunk.text });
                    break;
                case "toolcall_delta": {
                    sawToolCall = true;
                    if (pendingText.length > 0) {
                        pendingTextReclassified = true;
                        reclassifyTextPartsAsThinking(assistantMessage.content);
                    }
                    const { buffer, isNew } = upsertToolCallBuffer(
                        toolCallBuffers,
                        assistantMessage.content,
                        chunk,
                        this.createId,
                    );
                    if (isNew) {
                        this.events.messageUpdate(turnId, assistantMessage.id, {
                            kind: "toolcall_start",
                            toolCallId: buffer.id,
                            name: buffer.name,
                            index: buffer.index,
                        }, pendingTextReclassified ? { reclassifiedPendingText: pendingText } : undefined);
                    }
                    this.events.messageUpdate(turnId, assistantMessage.id, {
                        kind: "toolcall_delta",
                        text: chunk.argsText ?? stringifyToolInput(chunk.input),
                        toolCallId: buffer.id,
                        index: buffer.index,
                    });
                    break;
                }
            }
        }

        if (sawThinking) {
            this.events.messageUpdate(turnId, assistantMessage.id, { kind: "thinking_end" });
        }
        if (sawText) {
            this.events.messageUpdate(turnId, assistantMessage.id, { kind: "text_end" });
        }
        for (const buffer of toolCallBuffers) {
            this.events.messageUpdate(turnId, assistantMessage.id, {
                kind: "toolcall_end",
                toolCallId: buffer.id,
                index: buffer.index,
            });
        }

        const toolCalls = toolCallBuffers.map((buffer) => assistantMessage.content[buffer.partIndex]).filter(isToolCallPart);
        const hasToolCall = toolCalls.length > 0;
        assistantMessage.stopReason = stopReason ?? (hasToolCall ? "tool_calls" : "stop");
        const modelElapsedMs = elapsedSince(modelStartedAt, this.now());
        this.events.messageEnd(turnId, assistantMessage, {
            timing: {
                elapsedMs: modelElapsedMs,
                ...(firstModelChunkElapsedMs !== undefined ? { firstChunkElapsedMs: firstModelChunkElapsedMs } : {}),
                chunkCount: modelChunkCount,
                stopReason: assistantMessage.stopReason,
                toolCallCount: toolCalls.length,
            },
        });
        this.transcript.push(assistantMessage);

        const toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>> = [];
        let toolExecutionStoppedBy: "aborted" | "wall_clock_exceeded" | undefined;
        let toolExecutionElapsedMs: number | undefined;
        if (hasToolCall && terminalStatus === undefined) {
            const toolExecutionStartedAt = this.now();
            const execution = await this.executeBufferedToolCalls(turnId, turnIndex, toolCallBuffers);
            toolExecutionElapsedMs = elapsedSince(toolExecutionStartedAt, this.now());
            toolResults.push(...execution.toolResults);
            diagnostics.push(...execution.diagnostics);
            toolExecutionStoppedBy = execution.stoppedBy;
        } else if (hasToolCall) {
            diagnostics.push({
                type: "tool_required",
                message: this.options.toolExecutor
                    ? "Tool calls were not executed because the assistant message ended before a complete executable tool phase."
                    : "Tool calls are buffered but no tool executor is available.",
                toolCalls: toolCalls.map((part) => ({
                    id: part.id,
                    name: part.name,
                    index: part.index,
                })),
                ...(pendingTextReclassified ? { reclassifiedPendingText: pendingText } : {}),
            });
        }
        if (toolExecutionStoppedBy === "aborted") {
            terminalStatus = "aborted";
            diagnostics.push({ type: "user_abort" });
        } else if (toolExecutionStoppedBy === "wall_clock_exceeded") {
            terminalStatus = "incomplete";
            diagnostics.push({ type: "wall_clock_exceeded", maxWallClockMs: this.maxWallClockMs });
        }
        if (!hasToolCall && terminalStatus === undefined && pendingText.length === 0) {
            terminalStatus = "incomplete";
            diagnostics.push({
                type: "assistant_empty_response",
                message: sawThinking
                    ? "Assistant stream ended after thinking without final answer text."
                    : "Assistant stream ended without final answer text.",
            });
        }
        const status: TurnEndStatus = terminalStatus
            ?? (hasToolCall ? (toolResults.length > 0 ? "tool_results_ready" : "incomplete") : "completed");

        if (!hasToolCall && pendingText.length > 0 && status !== "error" && status !== "incomplete") {
            this.committedFinalText += pendingText;
            this.options.onCommittedFinalText?.(this.committedFinalText);
        }

        const turnToolTiming = summarizeTurnToolTiming(toolCalls, toolResults);
        const turnTiming: PaAgentTurnTiming = {
            ...turnToolTiming,
            elapsedMs: elapsedSince(turnStartedAt, this.now()),
            turnIndex,
            status,
            modelElapsedMs,
            ...(firstModelChunkElapsedMs !== undefined ? { firstModelChunkElapsedMs } : {}),
            modelChunkCount,
            toolCallCount: toolCalls.length,
            toolResultCount: toolResults.length,
            ...(toolExecutionElapsedMs !== undefined ? { toolExecutionElapsedMs } : {}),
        };
        const turnEndMetadata: Record<string, unknown> = {
            ...turnTiming,
            timing: turnTiming,
            ...(controlSnapshot ? { controlSnapshot: summarizeAgentControlSnapshot(controlSnapshot) } : {}),
            ...(metrics.length > 0 ? { metrics } : {}),
            ...(diagnostics.length > 0 ? { diagnostics } : {}),
        };
        this.events.turnEnd(
            turnId,
            status,
            turnEndMetadata,
            toolResults.length > 0 ? toolResults : undefined,
        );

        return {
            turnId,
            turnIndex,
            status,
            assistantMessage,
            committedFinalText: this.committedFinalText,
            pendingTextReclassified,
            toolCalls,
            toolResults,
            diagnostics,
            metrics,
            timing: turnTiming,
            ...(controlSnapshot ? { controlSnapshot } : {}),
        };
    }

    private async executeBufferedToolCalls(
        turnId: string,
        turnIndex: number,
        buffers: BufferedToolCall[],
    ): Promise<ToolExecutionSummary> {
        const parsedToolCalls = [...buffers]
            .sort(compareBufferedToolCallOrder)
            .map((buffer) => parseBufferedToolCall(buffer));
        const dispatch = this.resolveBatchExecutionMode(parsedToolCalls);
        if (dispatch === "parallel") {
            return this.executeToolCallsParallel(turnId, turnIndex, parsedToolCalls);
        }
        return this.executeToolCallsSequential(turnId, turnIndex, parsedToolCalls);
    }

    private resolveBatchExecutionMode(parsedToolCalls: ParsedBufferedToolCall[]): "sequential" | "parallel" {
        const requested: PaAgentToolExecutionMode = this.options.toolExecutionMode ?? "sequential";
        if (requested === "sequential") return "sequential";
        if (requested === "parallel") return "parallel";
        // hybrid: per-tool dispatch — any tool reporting "sequential" forces the whole batch serial.
        const executor = this.options.toolExecutor;
        const getMode = executor?.getExecutionMode;
        if (!executor || !getMode) return "parallel";
        for (const toolCall of parsedToolCalls) {
            if (getMode.call(executor, toolCall.name) === "sequential") {
                return "sequential";
            }
        }
        return "parallel";
    }

    private async executeToolCallsSequential(
        turnId: string,
        turnIndex: number,
        parsedToolCalls: ParsedBufferedToolCall[],
    ): Promise<ToolExecutionSummary> {
        const toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>> = [];
        const diagnostics: Array<Record<string, unknown>> = [];
        const meaningfulToolCallNames = collectMeaningfulToolCallNames(parsedToolCalls);

        for (const toolCall of parsedToolCalls) {
            if (this.isAborted()) {
                return { toolResults, diagnostics, stoppedBy: "aborted" };
            }
            if (this.isWallClockExceeded()) {
                return { toolResults, diagnostics, stoppedBy: "wall_clock_exceeded" };
            }

            this.events.toolExecutionStart(turnId, toolCall.id, toolCall.name, toolCall.input, {
                index: toolCall.index,
            });

            const skipResult = this.classifyPreflightSkip(toolCall, meaningfulToolCallNames);
            let executionResult: PaAgentToolExecutionResult;
            if (skipResult) {
                executionResult = skipResult;
            } else {
                this.seenToolCallKeys.add(normalizeToolCallKey(toolCall));
                this.toolCallCount += 1;
                executionResult = await this.executeRealToolCall(turnId, turnIndex, toolCall);
            }

            const toolResult = this.emitToolResult(turnId, toolCall, executionResult);
            toolResults.push(toolResult);

            if (executionResult.metadata?.stoppedBy === "wall_clock_exceeded") {
                return { toolResults, diagnostics, stoppedBy: "wall_clock_exceeded" };
            }
            if (executionResult.outcome === "aborted" || executionResult.outcome === "abort_timeout") {
                return { toolResults, diagnostics, stoppedBy: "aborted" };
            }
        }

        return { toolResults, diagnostics };
    }

    private async executeToolCallsParallel(
        turnId: string,
        turnIndex: number,
        parsedToolCalls: ParsedBufferedToolCall[],
    ): Promise<ToolExecutionSummary> {
        const toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>> = [];
        const diagnostics: Array<Record<string, unknown>> = [];

        if (this.isAborted()) {
            return { toolResults, diagnostics, stoppedBy: "aborted" };
        }
        if (this.isWallClockExceeded()) {
            return { toolResults, diagnostics, stoppedBy: "wall_clock_exceeded" };
        }

        const meaningfulToolCallNames = collectMeaningfulToolCallNames(parsedToolCalls);
        // Pre-flight pass: classify each tool call in deterministic order so state mutations
        // (seenToolCallKeys, toolCallCount) mirror the sequential path. Only the "real" executes run concurrently.
        const entries: ParallelToolEntry[] = [];
        for (const toolCall of parsedToolCalls) {
            const skipResult = this.classifyPreflightSkip(toolCall, meaningfulToolCallNames);
            if (skipResult) {
                entries.push({ toolCall, skipResult });
                continue;
            }
            this.seenToolCallKeys.add(normalizeToolCallKey(toolCall));
            this.toolCallCount += 1;
            entries.push({ toolCall });
        }

        for (const entry of entries) {
            this.events.toolExecutionStart(turnId, entry.toolCall.id, entry.toolCall.name, entry.toolCall.input, {
                index: entry.toolCall.index,
            });
        }

        const pending: Array<Promise<PaAgentToolExecutionResult>> = entries.map((entry) =>
            entry.skipResult !== undefined
                ? Promise.resolve(entry.skipResult)
                : this.executeRealToolCall(turnId, turnIndex, entry.toolCall),
        );
        const results = await Promise.all(pending);

        let stoppedBy: "aborted" | "wall_clock_exceeded" | undefined;
        for (let i = 0; i < entries.length; i++) {
            const executionResult = results[i];
            const toolResult = this.emitToolResult(turnId, entries[i].toolCall, executionResult);
            toolResults.push(toolResult);
            if (stoppedBy === undefined) {
                if (executionResult.metadata?.stoppedBy === "wall_clock_exceeded") {
                    stoppedBy = "wall_clock_exceeded";
                } else if (executionResult.outcome === "aborted" || executionResult.outcome === "abort_timeout") {
                    stoppedBy = "aborted";
                }
            }
        }

        return { toolResults, diagnostics, ...(stoppedBy ? { stoppedBy } : {}) };
    }

    private classifyPreflightSkip(
        toolCall: ParsedBufferedToolCall,
        meaningfulToolCallNames: Set<string>,
    ): PaAgentToolExecutionResult | null {
        // Ops Agent prerequisite: when toolMode=final_answer_only, the runtime exports zero tool
        // schemas (see pa-agent-runtime.ts `tool_definitions: input.toolMode === "final_answer_only" ? []`)
        // and the answer-completion policy expects the model to produce a final answer. If a model
        // still emits a tool call (hallucinated against the empty schema list, or a malformed
        // provider response), reject it hard rather than executing — same fail-loud spirit as
        // SPEC-TCR-04. Must run before any other classifyPreflightSkip branch so the rejection
        // surfaces even when the call is also a duplicate / over-budget / schema-invalid.
        if (this.currentTurnToolMode === "final_answer_only") {
            return {
                outcome: "policy_rejected",
                promptText: `Tool call ${toolCall.name} was not executed because this turn is final_answer_only. Produce a final answer from the existing observations.`,
                previewText: `Skipped ${toolCall.name}; toolMode=final_answer_only.`,
                metadata: {
                    outcome: "policy_rejected",
                    reason: "final_answer_only_violation",
                    toolName: toolCall.name,
                    preflightOnly: true,
                },
            };
        }
        const controlSnapshotSkip = this.classifyControlSnapshotSkip(toolCall);
        if (controlSnapshotSkip) return controlSnapshotSkip;
        if (isPlaceholderParsedToolCall(toolCall) && meaningfulToolCallNames.has(toolCall.name)) {
            return {
                outcome: "duplicate_skipped",
                promptText: "",
                previewText: `Skipped placeholder tool call ${toolCall.name}.`,
                includeInNextPrompt: false,
                metadata: {
                    outcome: "duplicate_skipped",
                    reason: "placeholder_tool_call",
                },
            };
        }
        if (this.toolCallCount >= this.maxToolCalls) {
            return {
                outcome: "budget_exceeded",
                promptText: `Tool call budget exceeded before running ${toolCall.name}.`,
                previewText: `Skipped ${toolCall.name}; maxToolCalls=${this.maxToolCalls}.`,
                metadata: {
                    outcome: "budget_exceeded",
                    maxToolCalls: this.maxToolCalls,
                },
            };
        }
        if (toolCall.parseError) {
            return {
                outcome: "schema_invalid",
                promptText: `Tool call ${toolCall.name} was not executed because its input JSON is invalid.`,
                previewText: toolCall.parseError,
                metadata: {
                    outcome: "schema_invalid",
                    reason: "invalid_tool_input",
                    parseError: toolCall.parseError,
                },
            };
        }
        const toolCallKey = normalizeToolCallKey(toolCall);
        if (this.seenToolCallKeys.has(toolCallKey)) {
            return {
                outcome: "duplicate_skipped",
                promptText: "",
                previewText: `Skipped duplicate tool call ${toolCall.name}.`,
                includeInNextPrompt: false,
                metadata: {
                    outcome: "duplicate_skipped",
                    reason: "duplicate_tool_call",
                },
            };
        }
        return null;
    }

    private classifyControlSnapshotSkip(toolCall: ParsedBufferedToolCall): PaAgentToolExecutionResult | null {
        const snapshot = this.currentTurnControlSnapshot;
        const constraints = toolConstraintsFromAgentControlSnapshot(snapshot);
        if (!snapshot || !constraints) return null;
        const notAllowed = constraints.allowedToolNames !== undefined
            && !constraints.allowedToolNames.has(toolCall.name);
        const blocked = constraints.blockedToolNames?.has(toolCall.name) === true;
        if (!notAllowed && !blocked) return null;
        const reason = blocked ? "control_snapshot_tool_blocked" : "control_snapshot_tool_not_allowed";
        return {
            outcome: "policy_rejected",
            promptText: `Tool call ${toolCall.name} was not executed because it is outside the current allowed tool scope. Use available tools or answer from existing observations.`,
            previewText: `Skipped ${toolCall.name}; ${reason}.`,
            metadata: {
                outcome: "policy_rejected",
                reason,
                toolName: toolCall.name,
                preflightOnly: true,
                exposureMode: snapshot.exposureMode,
                sourceScope: snapshot.sourceScope,
                ...(snapshot.blockedReasons[toolCall.name] ? { blockedReason: snapshot.blockedReasons[toolCall.name] } : {}),
                ...(constraints.allowedToolNames ? { allowedToolNames: [...constraints.allowedToolNames].sort() } : {}),
                ...(constraints.blockedToolNames ? { blockedToolNames: [...constraints.blockedToolNames].sort() } : {}),
            },
        };
    }

    private async executeRealToolCall(
        turnId: string,
        turnIndex: number,
        toolCall: ParsedBufferedToolCall,
    ): Promise<PaAgentToolExecutionResult> {
        const startedAt = this.now();
        const finalize = (result: PaAgentToolExecutionResult): PaAgentToolExecutionResult =>
            this.withToolExecutionTiming(result, startedAt);
        if (!this.options.toolExecutor) {
            return finalize({
                outcome: "recoverable_error",
                promptText: `Tool ${toolCall.name} could not run because no executor is available.`,
                metadata: { outcome: "recoverable_error", reason: "missing_tool_executor" },
            });
        }

        const controller = new AbortController();
        const onAbort = () => controller.abort();
        this.options.signal?.addEventListener("abort", onAbort, { once: true });
        if (this.options.signal?.aborted) {
            controller.abort();
        }

        const interrupt = this.createToolInterruptPromise(controller);
        const executionPromise: Promise<ToolExecutionRaceResult> = Promise.resolve().then(() =>
            this.options.toolExecutor!.execute({
                runId: this.options.runId,
                turnId,
                turnIndex,
                userInput: this.options.userInput,
                toolCall,
                signal: controller.signal,
            }),
        ).then(
            (result) => ({ type: "completed" as const, result }),
            (error) => ({ type: "rejected" as const, error }),
        );

        try {
            const first = await Promise.race([executionPromise, interrupt.promise]);
            interrupt.cleanup();

            switch (first.type) {
                case "completed":
                    return finalize(normalizeToolExecutionResult(first.result));
                case "rejected":
                    return finalize(this.toolExceptionResult(toolCall, first.error));
                case "tool_timeout":
                    return finalize({
                        outcome: this.toolTimeoutOutcome,
                        promptText: `Tool ${toolCall.name} timed out.`,
                        previewText: `Timed out after ${this.toolTimeoutMs}ms.`,
                        metadata: {
                            outcome: this.toolTimeoutOutcome,
                            reason: "tool_timeout",
                            timeoutMs: this.toolTimeoutMs,
                        },
                    });
                case "aborted":
                case "wall_clock_exceeded":
                    return finalize(await this.waitForInterruptedTool(first.type, executionPromise));
                case "abort_timeout":
                    return finalize({
                        outcome: "abort_timeout",
                        promptText: "",
                        includeInNextPrompt: false,
                        metadata: {
                            outcome: "abort_timeout",
                            reason: "user_abort",
                            stoppedBy: "aborted",
                        },
                    });
            }
            return finalize({
                outcome: "recoverable_error",
                promptText: `Tool ${toolCall.name} ended with an unknown runtime state.`,
                metadata: { outcome: "recoverable_error", reason: "unknown_tool_runtime_state" },
            });
        } finally {
            interrupt.cleanup();
            this.options.signal?.removeEventListener("abort", onAbort);
        }
    }

    private withToolExecutionTiming(
        result: PaAgentToolExecutionResult,
        startedAt: number,
    ): PaAgentToolExecutionResult {
        return {
            ...result,
            metadata: {
                ...result.metadata,
                executionElapsedMs: Math.max(0, this.now() - startedAt),
            },
        };
    }

    private toolExceptionResult(
        toolCall: ParsedBufferedToolCall,
        error: unknown,
    ): PaAgentToolExecutionResult {
        if (this.isAborted()) {
            return {
                outcome: "aborted",
                promptText: "",
                includeInNextPrompt: false,
                metadata: { outcome: "aborted", reason: "user_abort" },
            };
        }
        return {
            outcome: "recoverable_error",
            promptText: `Tool ${toolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`,
            previewText: error instanceof Error ? error.message : String(error),
            metadata: {
                outcome: "recoverable_error",
                reason: "tool_exception",
            },
        };
    }

    private async waitForInterruptedTool(
        interruptedBy: "aborted" | "wall_clock_exceeded",
        executionPromise: Promise<ToolExecutionRaceResult>,
    ): Promise<PaAgentToolExecutionResult> {
        const graceResult = await Promise.race([
            executionPromise,
            delay(this.toolAbortGraceMs).then<ToolExecutionRaceResult>(() => ({ type: "abort_timeout" })),
        ]);
        const reason = interruptedBy === "wall_clock_exceeded" ? "wall_clock_exceeded" : "user_abort";
        const stoppedBy = interruptedBy === "wall_clock_exceeded" ? "wall_clock_exceeded" : "aborted";
        if (graceResult.type === "abort_timeout") {
            return {
                outcome: "abort_timeout",
                promptText: "",
                includeInNextPrompt: false,
                metadata: {
                    outcome: "abort_timeout",
                    reason,
                    stoppedBy,
                    toolAbortGraceMs: this.toolAbortGraceMs,
                },
            };
        }
        return {
            outcome: "aborted",
            promptText: "",
            includeInNextPrompt: false,
            metadata: {
                outcome: "aborted",
                reason,
                stoppedBy,
            },
        };
    }

    private createToolInterruptPromise(controller: AbortController): {
        promise: Promise<ToolExecutionRaceResult>;
        cleanup: () => void;
    } {
        let settled = false;
        let toolTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
        let wallClockTimer: ReturnType<typeof setTimeout> | undefined;
        let settle: (result: ToolExecutionRaceResult) => void = () => undefined;

        const cleanup = () => {
            if (toolTimeoutTimer !== undefined) {
                clearTimeout(toolTimeoutTimer);
            }
            if (wallClockTimer !== undefined) {
                clearTimeout(wallClockTimer);
            }
            this.options.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (result: ToolExecutionRaceResult) => {
            if (settled) return;
            settled = true;
            controller.abort();
            settle(result);
        };
        const onAbort = () => finish({ type: "aborted" });

        const promise = new Promise<ToolExecutionRaceResult>((resolve) => {
            settle = resolve;
            this.options.signal?.addEventListener("abort", onAbort, { once: true });

            if (this.options.signal?.aborted) {
                finish({ type: "aborted" });
                return;
            }

            if (Number.isFinite(this.toolTimeoutMs) && this.toolTimeoutMs >= 0) {
                toolTimeoutTimer = setTimeout(() => finish({ type: "tool_timeout" }), this.toolTimeoutMs);
            }
            const wallClockRemainingMs = this.wallClockRemainingMs();
            if (wallClockRemainingMs !== undefined) {
                wallClockTimer = setTimeout(() => finish({ type: "wall_clock_exceeded" }), wallClockRemainingMs);
            }
        });

        return { promise, cleanup };
    }

    private emitToolResult(
        turnId: string,
        toolCall: ParsedBufferedToolCall,
        result: PaAgentToolExecutionResult,
    ): Extract<PaAgentMessage, { role: "toolResult" }> {
        const content = this.createToolResultContent(result);
        const isError = isErrorToolOutcome(result.outcome);

        this.events.toolExecutionEnd(turnId, toolCall.id, toolCall.name, result.outcome, {
            index: toolCall.index,
            isError,
            preflightOnly: isPreflightOnlyToolResult(result),
            ...(typeof content.metadata?.executionElapsedMs === "number"
                ? { timing: { elapsedMs: content.metadata.executionElapsedMs } }
                : {}),
            ...(content.metadata ? { contentMetadata: content.metadata } : {}),
        });

        const message: Extract<PaAgentMessage, { role: "toolResult" }> = {
            role: "toolResult",
            id: this.createId("message_tool_result"),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content,
            isError,
            timestamp: this.now(),
        };
        this.events.messageStart(turnId, message);
        this.events.messageEnd(turnId, message);
        this.transcript.push(message);
        return message;
    }

    private createToolResultContent(result: PaAgentToolExecutionResult): PaToolResultContent {
        const includeInNextPrompt = result.includeInNextPrompt ?? defaultIncludeInNextPrompt(result.outcome);
        const { promptText, truncated, originalLength } = includeInNextPrompt
            ? this.consumeObservationBudget(result.promptText)
            : { promptText: "", truncated: false, originalLength: result.promptText.length };
        return {
            promptText,
            ...(result.previewText !== undefined ? { previewText: result.previewText } : {}),
            includeInNextPrompt,
            ...(result.sourceRecords ? { sourceRecords: result.sourceRecords } : {}),
            ...(result.contextUsed ? { contextUsed: result.contextUsed } : {}),
            metadata: {
                outcome: result.outcome,
                ...result.metadata,
                ...(truncated ? {
                    observationTruncated: true,
                    originalPromptTextLength: originalLength,
                    maxObservationChars: this.maxObservationChars,
                } : {}),
            },
        };
    }

    private consumeObservationBudget(text: string): { promptText: string; truncated: boolean; originalLength: number } {
        const originalLength = text.length;
        if (!Number.isFinite(this.maxObservationChars) || this.maxObservationChars < 0) {
            return { promptText: text, truncated: false, originalLength };
        }
        const allowed = Math.max(0, this.remainingObservationChars);
        const promptText = text.slice(0, allowed);
        this.remainingObservationChars = Math.max(0, this.remainingObservationChars - promptText.length);
        return { promptText, truncated: promptText.length < text.length, originalLength };
    }

    private createUserMessage(): PaAgentMessage {
        return {
            role: "user",
            id: this.createId("message_user"),
            content: this.options.userMessageContent ?? this.options.userInput,
            timestamp: this.now(),
        };
    }

    private async decideAfterTurn(summary: PaAgentTurnSummary): Promise<PaAgentAfterTurnDecision> {
        if (this.options.hostPolicy) {
            const interrupt = this.createPolicyInterruptPromise();
            const decisionPromise: Promise<PolicyDecisionRaceResult> = Promise.resolve().then(() =>
                this.options.hostPolicy!.afterTurn(summary),
            ).then(
                (decision) => ({ type: "completed" as const, decision }),
                (error) => ({ type: "rejected" as const, error }),
            );
            try {
                const result = await Promise.race([decisionPromise, interrupt.promise]);
                switch (result.type) {
                    case "completed":
                        return result.decision;
                    case "rejected":
                        return {
                            action: "stop",
                            status: "error",
                            reason: "host_policy_error",
                            warnings: [{ type: "host_policy_error", message: errorMessage(result.error) }],
                        };
                    case "aborted":
                        return { action: "stop", status: "aborted", reason: "user_abort" };
                    case "wall_clock_exceeded":
                        return {
                            action: "stop",
                            status: "incomplete",
                            reason: "wall_clock_exceeded",
                            warnings: [{ type: "wall_clock_exceeded", maxWallClockMs: this.maxWallClockMs }],
                        };
                }
            } finally {
                interrupt.cleanup();
            }
        }
        return {
            action: "stop",
            status: this.agentStatusFromTurn(summary.status),
            reason: summary.status,
            ...(summary.diagnostics.length > 0 ? { diagnostics: summary.diagnostics } : {}),
        };
    }

    private createPolicyInterruptPromise(): {
        promise: Promise<PolicyDecisionRaceResult>;
        cleanup: () => void;
    } {
        let settled = false;
        let wallClockTimer: ReturnType<typeof setTimeout> | undefined;
        let settle: (result: PolicyDecisionRaceResult) => void = () => undefined;
        const cleanup = () => {
            if (wallClockTimer !== undefined) {
                clearTimeout(wallClockTimer);
            }
            this.options.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (result: PolicyDecisionRaceResult) => {
            if (settled) return;
            settled = true;
            settle(result);
        };
        const onAbort = () => finish({ type: "aborted" });

        const promise = new Promise<PolicyDecisionRaceResult>((resolve) => {
            settle = resolve;
            this.options.signal?.addEventListener("abort", onAbort, { once: true });
            if (this.options.signal?.aborted) {
                finish({ type: "aborted" });
                return;
            }
            const wallClockRemainingMs = this.wallClockRemainingMs();
            if (wallClockRemainingMs !== undefined) {
                wallClockTimer = setTimeout(() => finish({ type: "wall_clock_exceeded" }), wallClockRemainingMs);
            }
        });

        return { promise, cleanup };
    }

    private endAgent(status: AgentEndStatus, payload: Record<string, unknown>): void {
        const elapsedMs = elapsedSince(this.runStartedAt, this.now());
        const emittedToolCallCount = this.turns.reduce((total, turn) => {
            const value = turn.timing.toolCallCount;
            return total + (typeof value === "number" ? value : 0);
        }, 0);
        const timedPayload: Record<string, unknown> = {
            ...payload,
            loopElapsedMs: elapsedMs,
            turnCount: this.turns.length,
            turnTimings: this.turns.map((turn) => turn.timing),
            timing: {
                elapsedMs,
                turnCount: this.turns.length,
                toolCallCount: emittedToolCallCount,
            },
            endTiming: {
                elapsedMs,
                turnCount: this.turns.length,
                toolCallCount: emittedToolCallCount,
                executedToolCallCount: this.toolCallCount,
            },
        };
        this.endPayload = timedPayload;
        this.events.agentEnd(status, timedPayload);
    }

    private agentStatusFromTurn(status: TurnEndStatus): AgentEndStatus {
        switch (status) {
            case "completed":
                return "completed";
            case "completed_with_warning":
                return "completed_with_warning";
            case "aborted":
                return "aborted";
            case "error":
                return "error";
            case "tool_results_ready":
            case "incomplete":
                return "incomplete";
        }
    }

    private createResult(status: AgentEndStatus): PaAgentLoopResult {
        return {
            status,
            transcript: [...this.transcript],
            committedFinalText: this.committedFinalText,
            turns: [...this.turns],
            ...(this.endPayload ? { endPayload: this.endPayload } : {}),
        };
    }

    private async nextModelChunk(iterator: AsyncIterator<PaAgentModelStreamChunk>): Promise<NextModelChunkResult> {
        if (this.isAborted()) return { type: "aborted" };
        if (this.isWallClockExceeded()) return { type: "wall_clock_exceeded" };

        return new Promise<NextModelChunkResult>((resolve) => {
            let settled = false;
            let idleTimer: ReturnType<typeof setTimeout> | undefined;
            let wallClockTimer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
                if (idleTimer !== undefined) {
                    clearTimeout(idleTimer);
                }
                if (wallClockTimer !== undefined) {
                    clearTimeout(wallClockTimer);
                }
                this.options.signal?.removeEventListener("abort", onAbort);
            };
            const settle = (result: NextModelChunkResult) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(result);
            };
            const onAbort = () => {
                void iterator.return?.();
                settle({ type: "aborted" });
            };

            this.options.signal?.addEventListener("abort", onAbort, { once: true });
            if (Number.isFinite(this.assistantIdleTimeoutMs) && this.assistantIdleTimeoutMs > 0) {
                idleTimer = setTimeout(() => {
                    void iterator.return?.();
                    settle({ type: "idle" });
                }, this.assistantIdleTimeoutMs);
            }
            const wallClockRemainingMs = this.wallClockRemainingMs();
            if (wallClockRemainingMs !== undefined) {
                wallClockTimer = setTimeout(() => {
                    void iterator.return?.();
                    settle({ type: "wall_clock_exceeded" });
                }, wallClockRemainingMs);
            }

            iterator.next().then(
                (result) => {
                    if (this.isWallClockExceeded()) {
                        settle({ type: "wall_clock_exceeded" });
                        return;
                    }
                    settle(result.done
                        ? { type: "done" }
                        : { type: "chunk", chunk: result.value });
                },
                (error) => settle({ type: "error", error }),
            );
        });
    }

    private isAborted(): boolean {
        return this.options.signal?.aborted === true;
    }

    private isWallClockExceeded(): boolean {
        return Number.isFinite(this.maxWallClockMs)
            && this.maxWallClockMs >= 0
            && this.now() - this.runStartedAt >= this.maxWallClockMs;
    }

    private wallClockRemainingMs(): number | undefined {
        if (!Number.isFinite(this.maxWallClockMs) || this.maxWallClockMs < 0) {
            return undefined;
        }
        return Math.max(0, this.maxWallClockMs - (this.now() - this.runStartedAt));
    }
}

type NextModelChunkResult =
    | { type: "chunk"; chunk: PaAgentModelStreamChunk }
    | { type: "done" }
    | { type: "idle" }
    | { type: "aborted" }
    | { type: "wall_clock_exceeded" }
    | { type: "error"; error: unknown };

type ToolExecutionRaceResult =
    | { type: "completed"; result: PaAgentToolExecutionResult }
    | { type: "rejected"; error: unknown }
    | { type: "tool_timeout" }
    | { type: "aborted" }
    | { type: "wall_clock_exceeded" }
    | { type: "abort_timeout" };

type PolicyDecisionRaceResult =
    | { type: "completed"; decision: PaAgentAfterTurnDecision }
    | { type: "rejected"; error: unknown }
    | { type: "aborted" }
    | { type: "wall_clock_exceeded" };

interface BufferedToolCall {
    key: string;
    id: string;
    name: string;
    index: number;
    argsText: string;
    input?: unknown;
    hasStructuredInput: boolean;
    partIndex: number;
}

type ParsedBufferedToolCall = PaAgentToolCall & {
    parseError?: string;
};

interface ToolExecutionSummary {
    toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>>;
    diagnostics: Array<Record<string, unknown>>;
    stoppedBy?: "aborted" | "wall_clock_exceeded";
}

interface ParallelToolEntry {
    toolCall: ParsedBufferedToolCall;
    skipResult?: PaAgentToolExecutionResult;
}

function collectMeaningfulToolCallNames(parsedToolCalls: ParsedBufferedToolCall[]): Set<string> {
    return new Set(
        parsedToolCalls
            .filter(isMeaningfulParsedToolCall)
            .map((toolCall) => toolCall.name),
    );
}

function providerErrorDiagnostic(error: unknown): Record<string, unknown> {
    return {
        type: "provider_error",
        message: errorMessage(error),
    };
}

function isPreflightOnlyToolResult(result: PaAgentToolExecutionResult): boolean {
    if (result.metadata?.preflightOnly === true) return true;
    return result.outcome === "schema_invalid"
        || result.outcome === "budget_exceeded"
        || result.outcome === "duplicate_skipped";
}

function elapsedSince(startedAt: number, endedAt: number): number {
    return Math.max(0, endedAt - startedAt);
}

function appendTextPart(parts: AssistantMessagePart[], type: "thinking" | "text", text: string): void {
    const last = parts.at(-1);
    if (last?.type === type) {
        last.text += text;
        return;
    }
    parts.push({ type, text });
}

function reclassifyTextPartsAsThinking(parts: AssistantMessagePart[]): void {
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        if (part.type === "text") {
            parts[index] = { type: "thinking", text: part.text };
        }
    }
}

function isToolCallPart(part: AssistantMessagePart | undefined): part is Extract<AssistantMessagePart, { type: "toolCall" }> {
    return part?.type === "toolCall";
}

function compareBufferedToolCallOrder(a: BufferedToolCall, b: BufferedToolCall): number {
    return a.index - b.index || a.partIndex - b.partIndex;
}

function upsertToolCallBuffer(
    buffers: BufferedToolCall[],
    parts: AssistantMessagePart[],
    chunk: Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>,
    createId: (prefix: string) => string,
): { buffer: BufferedToolCall; isNew: boolean } {
    const key = createToolCallBufferKey(chunk, buffers.length);
    let buffer = buffers.find((candidate) => candidate.key === key);
    // Fallback: match by index when key format differs across stream chunks.
    // First chunk may use id-based key ("id:call_...") while subsequent chunks
    // only carry index ("index:0"). Without this fallback, arguments accumulate
    // in an orphaned buffer and the original buffer stays empty.
    if (!buffer && chunk.index !== undefined) {
        buffer = buffers.find((candidate) => candidate.index === chunk.index);
    }
    const isNew = buffer === undefined;

    if (!buffer) {
        const id = chunk.id ?? createId("tool_call");
        const index = chunk.index ?? buffers.length;
        buffer = {
            key,
            id,
            name: chunk.name,
            index,
            argsText: "",
            hasStructuredInput: false,
            partIndex: parts.length,
        };
        buffers.push(buffer);
        parts.push({
            type: "toolCall",
            id: buffer.id,
            name: buffer.name,
            input: "",
            index: buffer.index,
        });
    }

    if (chunk.argsText !== undefined) {
        buffer.argsText += chunk.argsText;
    }
    if (chunk.input !== undefined && hasMeaningfulStructuredToolInput(chunk.input)) {
        buffer.input = chunk.input;
        buffer.hasStructuredInput = true;
    }
    const part = parts[buffer.partIndex];
    if (part?.type === "toolCall") {
        part.input = buffer.hasStructuredInput ? buffer.input : buffer.argsText;
    }
    return { buffer, isNew };
}

function hasMeaningfulStructuredToolInput(input: unknown): boolean {
    if (input === null || input === undefined) return false;
    if (typeof input === "string") return input.trim().length > 0;
    if (Array.isArray(input)) return input.some(hasMeaningfulStructuredToolInput);
    if (typeof input === "object") {
        return Object.values(input as Record<string, unknown>).some(hasMeaningfulStructuredToolInput);
    }
    return true;
}

function createToolCallBufferKey(
    chunk: Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>,
    fallbackIndex: number,
): string {
    if (chunk.id) return `id:${chunk.id}`;
    if (chunk.index !== undefined) return `index:${chunk.index}`;
    return `order:${fallbackIndex}`;
}

function parseBufferedToolCall(buffer: BufferedToolCall): ParsedBufferedToolCall {
    const rawInputText = buffer.argsText;
    const trimmed = rawInputText.trim();
    if (trimmed.length > 0) {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                if (hasMeaningfulStructuredToolInput(parsed) || !buffer.hasStructuredInput) {
                    return {
                        type: "toolCall",
                        id: buffer.id,
                        name: buffer.name,
                        input: parsed,
                        index: buffer.index,
                        rawInputText,
                    };
                }
            } else if (!buffer.hasStructuredInput) {
                return {
                    type: "toolCall",
                    id: buffer.id,
                    name: buffer.name,
                    input: rawInputText,
                    index: buffer.index,
                    rawInputText,
                    parseError: "Tool call input JSON must be an object.",
                };
            }
        } catch (error) {
            if (!buffer.hasStructuredInput) {
                return {
                    type: "toolCall",
                    id: buffer.id,
                    name: buffer.name,
                    input: rawInputText,
                    index: buffer.index,
                    rawInputText,
                    parseError: error instanceof Error ? error.message : String(error),
                };
            }
        }
    }

    if (buffer.hasStructuredInput) {
        return {
            type: "toolCall",
            id: buffer.id,
            name: buffer.name,
            input: buffer.input,
            index: buffer.index,
            rawInputText: buffer.argsText || undefined,
        };
    }

    if (trimmed.length === 0) {
        return {
            type: "toolCall",
            id: buffer.id,
            name: buffer.name,
            input: {},
            index: buffer.index,
        };
    }

    return {
        type: "toolCall",
        id: buffer.id,
        name: buffer.name,
        input: rawInputText,
        index: buffer.index,
        rawInputText,
        parseError: "Tool call input JSON must be an object.",
    };
}

function isMeaningfulParsedToolCall(toolCall: ParsedBufferedToolCall): boolean {
    return !toolCall.parseError && hasMeaningfulStructuredToolInput(toolCall.input);
}

function isPlaceholderParsedToolCall(toolCall: ParsedBufferedToolCall): boolean {
    return !toolCall.parseError && !hasMeaningfulStructuredToolInput(toolCall.input);
}

function normalizeToolCallKey(toolCall: ParsedBufferedToolCall): string {
    return `${toolCall.name}:${stableStringify(toolCall.input)}`;
}

function summarizeTurnToolTiming(
    toolCalls: readonly AssistantMessagePart[],
    toolResults: readonly Extract<PaAgentMessage, { role: "toolResult" }>[],
): Pick<
    PaAgentTurnTiming,
    "toolNames" | "executorInvokedToolNames" | "preflightSkippedToolNames" | "toolOutcomes"
> {
    const toolNames = toolCalls
        .filter(isToolCallPart)
        .map((toolCall) => toolCall.name);
    const toolOutcomes = toolResults.map((result): PaAgentTurnToolOutcome => {
        const metadata = result.content.metadata;
        const executionElapsedMs = readMetadataNumber(metadata, "executionElapsedMs");
        return {
            toolName: result.toolName,
            isError: result.isError,
            includeInNextPrompt: result.content.includeInNextPrompt,
            ...(readMetadataString(metadata, "outcome") ? { outcome: readMetadataString(metadata, "outcome") } : {}),
            ...(readMetadataString(metadata, "reason") ? { reason: readMetadataString(metadata, "reason") } : {}),
            ...(executionElapsedMs !== undefined ? { executionElapsedMs } : {}),
        };
    });
    const executorInvokedToolNames = toolOutcomes
        .filter((outcome) => outcome.executionElapsedMs !== undefined)
        .map((outcome) => outcome.toolName);
    const preflightSkippedToolNames = toolOutcomes
        .filter((outcome) => outcome.executionElapsedMs === undefined)
        .map((outcome) => outcome.toolName);
    return {
        ...(toolNames.length > 0 ? { toolNames } : {}),
        ...(executorInvokedToolNames.length > 0 ? { executorInvokedToolNames } : {}),
        ...(preflightSkippedToolNames.length > 0 ? { preflightSkippedToolNames } : {}),
        ...(toolOutcomes.length > 0 ? { toolOutcomes } : {}),
    };
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = metadata?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = metadata?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeToolExecutionResult(result: PaAgentToolExecutionResult): PaAgentToolExecutionResult {
    return {
        ...result,
        includeInNextPrompt: result.includeInNextPrompt ?? defaultIncludeInNextPrompt(result.outcome),
        metadata: {
            outcome: result.outcome,
            ...result.metadata,
        },
    };
}

function defaultIncludeInNextPrompt(outcome: ToolExecutionOutcome): boolean {
    switch (outcome) {
        case "success":
        case "recoverable_error":
        case "schema_invalid":
        case "policy_rejected":
        case "budget_exceeded":
            return true;
        case "duplicate_skipped":
        case "aborted":
        case "abort_timeout":
            return false;
    }
}

function isErrorToolOutcome(outcome: ToolExecutionOutcome): boolean {
    return outcome !== "success" && outcome !== "duplicate_skipped";
}

function stringifyToolInput(input: unknown): string {
    if (typeof input === "string") return input;
    if (input === undefined) return "";
    return JSON.stringify(input);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function createIncrementingIdFactory(): (prefix: string) => string {
    let nextId = 1;
    return (prefix: string) => `${prefix}_${nextId++}`;
}
