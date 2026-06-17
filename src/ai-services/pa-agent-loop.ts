import {
    AgentLifecycleEventEmitter,
} from "./agent-runtime-primitives";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import { errorMessage } from "./agent-utils";
import {
    deriveContinuedAgentControlSnapshot,
    summarizeAgentControlSnapshot,
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
import { ModelChunkConsumer, appendTextPart } from "./pa-agent-chunk-consumer";
import {
    ToolExecutionDispatcher,
    defaultIncludeInNextPrompt,
    hasMeaningfulStructuredToolInput,
} from "./pa-agent-tool-dispatcher";
import type {
    BufferedToolCall,
    PaAgentAfterTurnDecision,
    PaAgentModelStreamChunk,
    PaAgentToolExecutionMode,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
    PaAgentToolMode,
    ParsedBufferedToolCall,
    PolicyDecisionRaceResult,
} from "./pa-agent-types";

/** @deprecated Import from `./pa-agent-types` instead. Will be removed in v2.5. */
export type {
    BufferedToolCall,
    PaAgentAfterTurnDecision,
    PaAgentModelStreamChunk,
    PaAgentToolCall,
    PaAgentToolExecutionInput,
    PaAgentToolExecutionMode,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
    PaAgentToolMode,
    ParsedBufferedToolCall,
    PolicyDecisionRaceResult,
} from "./pa-agent-types";

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
    private readonly assistantIdleTimeoutMs: number;
    private readonly maxWallClockMs: number;
    private readonly runStartedAt: number;
    private readonly startupTimings: readonly PaAgentTimingEntry[];
    private readonly transcript: PaAgentMessage[] = [];
    private readonly turns: PaAgentTurnSummary[] = [];
    private readonly dispatcher: ToolExecutionDispatcher;
    private committedFinalText = "";
    private endPayload?: Record<string, unknown>;

    constructor(private readonly options: PaAgentLoopOptions) {
        this.now = options.now ?? Date.now;
        this.createId = options.createId ?? createIncrementingIdFactory();
        this.maxTurns = options.maxTurns ?? 20;
        this.assistantIdleTimeoutMs = options.assistantIdleTimeoutMs ?? 60_000;
        this.maxWallClockMs = options.maxWallClockMs ?? 180_000;
        this.runStartedAt = this.now();
        this.startupTimings = options.startupTimings ?? [];
        this.events = new AgentLifecycleEventEmitter({
            runId: options.runId,
            now: this.now,
            onEvent: options.onEvent,
        });
        this.dispatcher = new ToolExecutionDispatcher({
            toolExecutor: options.toolExecutor,
            toolExecutionMode: options.toolExecutionMode ?? "sequential",
            signal: options.signal,
            runId: options.runId,
            userInput: options.userInput,
            toolTimeoutMs: options.toolTimeoutMs ?? 30_000,
            toolTimeoutOutcome: options.toolTimeoutOutcome ?? "recoverable_error",
            toolAbortGraceMs: options.toolAbortGraceMs ?? 2_000,
            maxToolCalls: options.maxToolCalls ?? 30,
            now: this.now,
            isAborted: () => this.isAborted(),
            isWallClockExceeded: () => this.isWallClockExceeded(),
            wallClockRemainingMs: () => this.wallClockRemainingMs(),
            events: this.events,
            emitToolResult: (turnId, toolCall, result) => this.emitToolResult(turnId, toolCall, result),
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

        const consumer = iterator
            ? new ModelChunkConsumer(iterator, {
                signal: this.options.signal,
                assistantIdleTimeoutMs: this.assistantIdleTimeoutMs,
                isAborted: () => this.isAborted(),
                isWallClockExceeded: () => this.isWallClockExceeded(),
                wallClockRemainingMs: () => this.wallClockRemainingMs(),
            })
            : undefined;

        while (consumer) {
            const next = await consumer.nextChunk();
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
            const execution = await this.dispatcher.executeBufferedToolCalls(
                turnId, turnIndex, toolCallBuffers, toolMode, controlSnapshot,
            );
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
        const promptText = includeInNextPrompt ? result.promptText : "";
        const originalLength = result.promptText.length;
        return {
            promptText,
            ...(result.previewText !== undefined ? { previewText: result.previewText } : {}),
            includeInNextPrompt,
            ...(result.sourceRecords ? { sourceRecords: result.sourceRecords } : {}),
            ...(result.contextUsed ? { contextUsed: result.contextUsed } : {}),
            metadata: {
                outcome: result.outcome,
                ...result.metadata,
                originalLength,
                observationChars: promptText.length,
            },
        };
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
                executedToolCallCount: this.dispatcher.toolCallCount,
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

    private createPolicyInterruptPromise(): {
        promise: Promise<PolicyDecisionRaceResult>;
        cleanup: () => void;
    } {
        let settled = false;
        let wallClockTimer: PlatformTimeoutHandle | undefined;
        let settle: (result: PolicyDecisionRaceResult) => void = () => undefined;
        const cleanup = () => {
            if (wallClockTimer !== undefined) clearPlatformTimeout(wallClockTimer);
            this.options.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (result: PolicyDecisionRaceResult) => {
            if (settled) return;
            settled = true;
            cleanup();
            settle(result);
        };
        const onAbort = () => finish({ type: "aborted" });
        const promise = new Promise<PolicyDecisionRaceResult>((resolve) => {
            settle = resolve;
            this.options.signal?.addEventListener("abort", onAbort, { once: true });
            if (this.options.signal?.aborted) { finish({ type: "aborted" }); return; }
            const remaining = this.wallClockRemainingMs();
            if (remaining !== undefined) {
                wallClockTimer = setPlatformTimeout(() => finish({ type: "wall_clock_exceeded" }), remaining);
            }
        });
        return { promise, cleanup };
    }
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

function createToolCallBufferKey(
    chunk: Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>,
    fallbackIndex: number,
): string {
    if (chunk.id) return `id:${chunk.id}`;
    if (chunk.index !== undefined) return `index:${chunk.index}`;
    return `order:${fallbackIndex}`;
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

function isErrorToolOutcome(outcome: ToolExecutionOutcome): boolean {
    return outcome !== "success" && outcome !== "duplicate_skipped";
}

function stringifyToolInput(input: unknown): string {
    if (typeof input === "string") return input;
    if (input === undefined) return "";
    return JSON.stringify(input);
}

function createIncrementingIdFactory(): (prefix: string) => string {
    let nextId = 1;
    return (prefix: string) => `${prefix}_${nextId++}`;
}
