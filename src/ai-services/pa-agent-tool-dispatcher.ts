import { stableStringify } from "./agent-utils";
import {
    toolConstraintsFromAgentControlSnapshot,
    type AgentControlSnapshot,
} from "./pa-agent-control-policy";
import type {
    PaAgentMessage,
    ToolExecutionOutcome,
} from "./chat-types";
import type { AgentLifecycleEventEmitter } from "./agent-runtime-primitives";
import type {
    BufferedToolCall,
    PaAgentToolExecutionMode,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
    PaAgentToolMode,
    ParsedBufferedToolCall,
} from "./pa-agent-types";

/** @deprecated Import from `./pa-agent-types` instead. Will be removed in v2.5. */
export type {
    BufferedToolCall,
    ParsedBufferedToolCall,
    PolicyDecisionRaceResult,
} from "./pa-agent-types";

// ─── exported types ──────────────────────────────────────────────────

export interface ToolExecutionSummary {
    toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>>;
    diagnostics: Array<Record<string, unknown>>;
    stoppedBy?: "aborted" | "wall_clock_exceeded";
}

// ─── config ──────────────────────────────────────────────────────────

export type EmitToolResultFn = (
    turnId: string,
    toolCall: ParsedBufferedToolCall,
    result: PaAgentToolExecutionResult,
) => Extract<PaAgentMessage, { role: "toolResult" }>;

export interface ToolDispatcherConfig {
    toolExecutor?: PaAgentToolExecutor;
    toolExecutionMode: PaAgentToolExecutionMode;
    signal?: AbortSignal;
    runId: string;
    userInput: string;
    toolTimeoutMs: number;
    toolTimeoutOutcome: ToolExecutionOutcome;
    toolAbortGraceMs: number;
    maxToolCalls: number;
    now: () => number;
    isAborted: () => boolean;
    isWallClockExceeded: () => boolean;
    wallClockRemainingMs: () => number | undefined;
    events: AgentLifecycleEventEmitter;
    emitToolResult: EmitToolResultFn;
}

// ─── class ───────────────────────────────────────────────────────────

export class ToolExecutionDispatcher {
    private readonly seenToolCallKeys = new Set<string>();
    private _toolCallCount = 0;

    get toolCallCount(): number { return this._toolCallCount; }

    constructor(private readonly config: ToolDispatcherConfig) {}

    async executeBufferedToolCalls(
        turnId: string,
        turnIndex: number,
        buffers: BufferedToolCall[],
        turnToolMode: PaAgentToolMode | undefined,
        turnControlSnapshot: AgentControlSnapshot | undefined,
    ): Promise<ToolExecutionSummary> {
        const parsedToolCalls = [...buffers]
            .sort(compareBufferedToolCallOrder)
            .map((buffer) => parseBufferedToolCall(buffer));
        const dispatch = this.resolveBatchExecutionMode(parsedToolCalls);
        if (dispatch === "parallel") {
            return this.executeToolCallsParallel(turnId, turnIndex, parsedToolCalls, turnToolMode, turnControlSnapshot);
        }
        return this.executeToolCallsSequential(turnId, turnIndex, parsedToolCalls, turnToolMode, turnControlSnapshot);
    }

    private resolveBatchExecutionMode(parsedToolCalls: ParsedBufferedToolCall[]): "sequential" | "parallel" {
        const requested = this.config.toolExecutionMode;
        if (requested === "sequential") return "sequential";
        if (requested === "parallel") return "parallel";
        // hybrid: per-tool dispatch — any tool reporting "sequential" forces the whole batch serial.
        const executor = this.config.toolExecutor;
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
        turnToolMode: PaAgentToolMode | undefined,
        turnControlSnapshot: AgentControlSnapshot | undefined,
    ): Promise<ToolExecutionSummary> {
        const toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>> = [];
        const diagnostics: Array<Record<string, unknown>> = [];
        const meaningfulToolCallNames = collectMeaningfulToolCallNames(parsedToolCalls);

        for (const toolCall of parsedToolCalls) {
            if (this.config.isAborted()) {
                return { toolResults, diagnostics, stoppedBy: "aborted" };
            }
            if (this.config.isWallClockExceeded()) {
                return { toolResults, diagnostics, stoppedBy: "wall_clock_exceeded" };
            }

            this.config.events.toolExecutionStart(turnId, toolCall.id, toolCall.name, toolCall.input, {
                index: toolCall.index,
            });

            const skipResult = this.classifyPreflightSkip(toolCall, meaningfulToolCallNames, turnToolMode, turnControlSnapshot);
            let executionResult: PaAgentToolExecutionResult;
            if (skipResult) {
                executionResult = skipResult;
            } else {
                this.seenToolCallKeys.add(normalizeToolCallKey(toolCall));
                this._toolCallCount += 1;
                executionResult = await this.executeRealToolCall(turnId, turnIndex, toolCall);
            }

            const toolResult = this.config.emitToolResult(turnId, toolCall, executionResult);
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
        turnToolMode: PaAgentToolMode | undefined,
        turnControlSnapshot: AgentControlSnapshot | undefined,
    ): Promise<ToolExecutionSummary> {
        const toolResults: Array<Extract<PaAgentMessage, { role: "toolResult" }>> = [];
        const diagnostics: Array<Record<string, unknown>> = [];

        if (this.config.isAborted()) {
            return { toolResults, diagnostics, stoppedBy: "aborted" };
        }
        if (this.config.isWallClockExceeded()) {
            return { toolResults, diagnostics, stoppedBy: "wall_clock_exceeded" };
        }

        const meaningfulToolCallNames = collectMeaningfulToolCallNames(parsedToolCalls);
        // Pre-flight pass: classify each tool call in deterministic order so state mutations
        // (seenToolCallKeys, toolCallCount) mirror the sequential path. Only the "real" executes run concurrently.
        const entries: ParallelToolEntry[] = [];
        for (const toolCall of parsedToolCalls) {
            const skipResult = this.classifyPreflightSkip(toolCall, meaningfulToolCallNames, turnToolMode, turnControlSnapshot);
            if (skipResult) {
                entries.push({ toolCall, skipResult });
                continue;
            }
            this.seenToolCallKeys.add(normalizeToolCallKey(toolCall));
            this._toolCallCount += 1;
            entries.push({ toolCall });
        }

        for (const entry of entries) {
            this.config.events.toolExecutionStart(turnId, entry.toolCall.id, entry.toolCall.name, entry.toolCall.input, {
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
            const toolResult = this.config.emitToolResult(turnId, entries[i].toolCall, executionResult);
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
        turnToolMode: PaAgentToolMode | undefined,
        turnControlSnapshot: AgentControlSnapshot | undefined,
    ): PaAgentToolExecutionResult | null {
        // Ops Agent prerequisite: when toolMode=final_answer_only, the runtime exports zero tool
        // schemas (see pa-agent-runtime.ts `tool_definitions: input.toolMode === "final_answer_only" ? []`)
        // and the answer-completion policy expects the model to produce a final answer. If a model
        // still emits a tool call (hallucinated against the empty schema list, or a malformed
        // provider response), reject it hard rather than executing — same fail-loud spirit as
        // SPEC-TCR-04. Must run before any other classifyPreflightSkip branch so the rejection
        // surfaces even when the call is also a duplicate / over-budget / schema-invalid.
        if (turnToolMode === "final_answer_only") {
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
        const controlSnapshotSkip = this.classifyControlSnapshotSkip(toolCall, turnControlSnapshot);
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
        if (this.toolCallCount >= this.config.maxToolCalls) {
            return {
                outcome: "budget_exceeded",
                promptText: `Tool call budget exceeded before running ${toolCall.name}.`,
                previewText: `Skipped ${toolCall.name}; maxToolCalls=${this.config.maxToolCalls}.`,
                metadata: {
                    outcome: "budget_exceeded",
                    maxToolCalls: this.config.maxToolCalls,
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

    private classifyControlSnapshotSkip(
        toolCall: ParsedBufferedToolCall,
        turnControlSnapshot: AgentControlSnapshot | undefined,
    ): PaAgentToolExecutionResult | null {
        const snapshot = turnControlSnapshot;
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
        const startedAt = this.config.now();
        const finalize = (result: PaAgentToolExecutionResult): PaAgentToolExecutionResult =>
            this.withToolExecutionTiming(result, startedAt);
        if (!this.config.toolExecutor) {
            return finalize({
                outcome: "recoverable_error",
                promptText: `Tool ${toolCall.name} could not run because no executor is available.`,
                metadata: { outcome: "recoverable_error", reason: "missing_tool_executor" },
            });
        }

        const controller = new AbortController();
        const onAbort = () => controller.abort();
        this.config.signal?.addEventListener("abort", onAbort, { once: true });
        if (this.config.signal?.aborted) {
            controller.abort();
        }

        const interrupt = this.createToolInterruptPromise(controller);
        const executionPromise: Promise<ToolExecutionRaceResult> = Promise.resolve().then(() =>
            this.config.toolExecutor!.execute({
                runId: this.config.runId,
                turnId,
                turnIndex,
                userInput: this.config.userInput,
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
                        outcome: this.config.toolTimeoutOutcome,
                        promptText: `Tool ${toolCall.name} timed out.`,
                        previewText: `Timed out after ${this.config.toolTimeoutMs}ms.`,
                        metadata: {
                            outcome: this.config.toolTimeoutOutcome,
                            reason: "tool_timeout",
                            timeoutMs: this.config.toolTimeoutMs,
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
            this.config.signal?.removeEventListener("abort", onAbort);
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
                executionElapsedMs: Math.max(0, this.config.now() - startedAt),
            },
        };
    }

    private toolExceptionResult(
        toolCall: ParsedBufferedToolCall,
        error: unknown,
    ): PaAgentToolExecutionResult {
        if (this.config.isAborted()) {
            return {
                outcome: "aborted",
                promptText: "",
                includeInNextPrompt: false,
                metadata: { outcome: "aborted", reason: "user_abort" },
            };
        }
        const rawMsg = error instanceof Error ? error.message : String(error);
        const safeMsg = rawMsg.replace(/\/[^\s:]+/g, "<path>").slice(0, 200);
        return {
            outcome: "recoverable_error",
            promptText: `Tool ${toolCall.name} failed: ${safeMsg}`,
            previewText: safeMsg,
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
            delay(this.config.toolAbortGraceMs).then<ToolExecutionRaceResult>(() => ({ type: "abort_timeout" })),
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
                    toolAbortGraceMs: this.config.toolAbortGraceMs,
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
            this.config.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (result: ToolExecutionRaceResult) => {
            if (settled) return;
            settled = true;
            cleanup();
            controller.abort();
            settle(result);
        };
        const onAbort = () => finish({ type: "aborted" });

        const promise = new Promise<ToolExecutionRaceResult>((resolve) => {
            settle = resolve;
            this.config.signal?.addEventListener("abort", onAbort, { once: true });

            if (this.config.signal?.aborted) {
                finish({ type: "aborted" });
                return;
            }

            if (Number.isFinite(this.config.toolTimeoutMs) && this.config.toolTimeoutMs >= 0) {
                toolTimeoutTimer = setTimeout(() => finish({ type: "tool_timeout" }), this.config.toolTimeoutMs);
            }
            const wallClockRemainingMs = this.config.wallClockRemainingMs();
            if (wallClockRemainingMs !== undefined) {
                wallClockTimer = setTimeout(() => finish({ type: "wall_clock_exceeded" }), wallClockRemainingMs);
            }
        });

        return { promise, cleanup };
    }
}

// ─── exported utility functions ──────────────────────────────────────

export function hasMeaningfulStructuredToolInput(input: unknown): boolean {
    if (input === null || input === undefined) return false;
    if (typeof input === "string") return input.trim().length > 0;
    if (Array.isArray(input)) return input.some(hasMeaningfulStructuredToolInput);
    if (typeof input === "object") {
        return Object.values(input as Record<string, unknown>).some(hasMeaningfulStructuredToolInput);
    }
    return true;
}

export function defaultIncludeInNextPrompt(outcome: ToolExecutionOutcome): boolean {
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

// ─── internal types ──────────────────────────────────────────────────

type ToolExecutionRaceResult =
    | { type: "completed"; result: PaAgentToolExecutionResult }
    | { type: "rejected"; error: unknown }
    | { type: "tool_timeout" }
    | { type: "aborted" }
    | { type: "wall_clock_exceeded" }
    | { type: "abort_timeout" };

interface ParallelToolEntry {
    toolCall: ParsedBufferedToolCall;
    skipResult?: PaAgentToolExecutionResult;
}

// ─── internal functions ──────────────────────────────────────────────

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

function compareBufferedToolCallOrder(a: BufferedToolCall, b: BufferedToolCall): number {
    return a.index - b.index || a.partIndex - b.partIndex;
}

function collectMeaningfulToolCallNames(parsedToolCalls: ParsedBufferedToolCall[]): Set<string> {
    return new Set(
        parsedToolCalls
            .filter(isMeaningfulParsedToolCall)
            .map((toolCall) => toolCall.name),
    );
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
