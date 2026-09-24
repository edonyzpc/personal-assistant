import {
    AgentLifecycleEventEmitter,
} from "./agent-runtime-primitives";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import { errorMessage } from "./agent-utils";
import type { AgentDebugLog } from './pa-agent-debug';
import { PaAgentContextOverflowError } from "./context/PaAgentContextOverflowError";
import { getProviderAdmissionError } from "./provider-admission-error";
import { parseTaskIncompleteOutput, REPORT_TASK_INCOMPLETE } from './pa-agent-task-outcome';
import type { AgentRunLease } from "./agent-run-coordinator";
import { createAbortError, isAbortError } from "./chat-utils";
import {
    createAgentControlSnapshot,
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
    signal?: AbortSignal;
    /** Internal request-boundary hook used only when a transport retries physically. */
    prepareForProviderRetry?: () => Promise<PaAgentModelInput>;
    /** Marks the boundary immediately before a physical Provider request is dispatched. */
    notifyProviderRequestStarted?: () => void;
    /** Marks an HTTP attempt as ended unsuccessfully before SDK retry/backoff. */
    notifyProviderRequestFailed?: () => void;
}

export interface PaAgentModel {
    /** When true, preparation ends only at notifyProviderRequestStarted. */
    reportsProviderRequestStart?: boolean;
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
    /** Host-admitted pure output candidate; final Host Policy still decides delivery. */
    nativeWriting?: { body: string; explanation: string };
    nativeWritingAttempted?: true;
    /** Agent-authored structured terminal result, never inferred from answer wording. */
    agentReportedIncomplete?: true;
}

export interface PaAgentTerminalPolicyContext {
    reason: string;
    defaultStatus: AgentEndStatus;
    /** Turn summary skipped by the Loop when it entered the reserved final turn. */
    unobservedTurnSummary?: PaAgentTurnSummary;
}

export type PaAgentTerminalDecision = Extract<PaAgentAfterTurnDecision, { action: "stop" }> & {
    status: AgentEndStatus;
};

export interface PaAgentFinalizationTurnPreparationContext {
    /** Loop-owned fallback instruction used when the Host has no narrower terminal contract. */
    defaultRuntimeInstruction: string;
    /** Loop-owned final-only projection before any Host refinement. */
    defaultControlSnapshot?: AgentControlSnapshot;
}

export interface PaAgentFinalizationTurnPreparation {
    runtimeInstruction?: string;
    controlSnapshot?: AgentControlSnapshot;
    /**
     * Treat an otherwise ordinary empty reserved response as success because
     * the Host already produced a complete non-text result (for example, an
     * inline confirmation card). Deadline, abort, error, and tool-call paths
     * remain ineligible.
     */
    allowEmptyResponse?: boolean;
}

export interface PaAgentHostPolicy {
    afterTurn(summary: PaAgentTurnSummary): PaAgentAfterTurnDecision | Promise<PaAgentAfterTurnDecision>;
    /**
     * Synchronous preparation seam for the single Loop-owned reserved turn.
     * The Host may narrow its instruction/control projection, but the Loop
     * always keeps the turn in `final_answer_only` mode and never reopens tools.
     */
    prepareFinalizationTurn?(
        summary: PaAgentTurnSummary,
        context: PaAgentFinalizationTurnPreparationContext,
    ): PaAgentFinalizationTurnPreparation;
    /**
     * Terminal-only policy seam for a Loop-owned deadline finalization. It may
     * refine status/warnings/diagnostics, but cannot schedule another turn or
     * reopen tools after the ordinary-turn soft deadline.
     */
    finalizeAfterTurn?(
        summary: PaAgentTurnSummary,
        context: PaAgentTerminalPolicyContext,
    ): PaAgentTerminalDecision | Promise<PaAgentTerminalDecision>;
}

export interface PaAgentTurnLeaseContext {
    runId: string;
    turnIndex: number;
    signal?: AbortSignal;
}

export type PaAgentTurnLeaseProvider = (
    context: PaAgentTurnLeaseContext,
) => AgentRunLease | PromiseLike<AgentRunLease>;

export interface PaAgentLoopOptions {
    runId: string;
    userInput: string;
    /** Host-supplied identity shared with request-local source admission. */
    userMessageId?: string;
    userImages?: import("../chat/image-types").MessageImage[];
    writingRequest?: import("./chat-types").ChatWritingRequest;
    /** Host opt-in only. Pagelet and existing text output retain their own protocol. */
    nativeWriting?: {
        contextHandle: string;
        getContextHandle?: () => string | undefined;
        maxTextChars: number;
        isCurrent: () => boolean;
        isValidContextHandle: (value: unknown) => value is string;
        createCollector: (contextHandle: string, maxTextChars: number) => {
            readonly hasWritingCall: boolean;
            readonly isCandidate: boolean;
            readonly providerIdentity?: { id?: string; index?: number };
            readonly rawArguments: string;
            consume(chunk: Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>): void;
            decode(): { body: string; explanation: string } | undefined;
        };
        outputName: NonNullable<AgentControlSnapshot["writingOutput"]>;
        finalizationInstruction: string;
        correctionInstruction: string;
        strategyChangeInstruction: string;
    };
    /** Host source receipt for ordinary text delivery, independent of cancellation. */
    isFinalTextCurrent?: () => boolean;
    /** Exposes the optional pure-output incomplete report in the Chat runtime. */
    allowTaskIncompleteReport?: boolean | ((runtimeInstruction?: string) => boolean);
    userMessageContent?: UserMessageContent;
    model: PaAgentModel;
    /** Request-local projection hook invoked before every logical model request. */
    prepareModelInput?: (
        input: PaAgentModelInput,
    ) => PaAgentModelInput | PromiseLike<PaAgentModelInput>;
    toolExecutor?: PaAgentToolExecutor;
    hostPolicy?: PaAgentHostPolicy;
    now?: () => number;
    createId?: (prefix: string) => string;
    onEvent?: (event: AgentEvent) => void;
    onDebug?: AgentDebugLog;
    onCommittedFinalText?: (snapshot: string) => void;
    hostContext?: Record<string, unknown>;
    initialRuntimeInstruction?: string;
    initialControlSnapshot?: AgentControlSnapshot;
    maxTurns?: number;
    maxToolCalls?: number;
    maxObservationChars?: number;
    /** Buffered bridges have no meaningful inter-chunk network activity; the absolute wall clock remains authoritative. */
    providerResponseDelivery?: 'incremental' | 'buffered';
    assistantIdleTimeoutMs?: number;
    /** Absolute deadline for one physical model or ordinary remote-tool attempt. */
    remoteAttemptTimeoutMs?: number;
    maxWallClockMs?: number;
    /** Host run origin in the same clock as `now`; includes preparation before loop construction. */
    runStartedAt?: number;
    /**
     * Optional final-answer reserve inside `maxWallClockMs`. Ordinary turns and
     * their lease waits stop at the soft deadline; `final_answer_only` may use
     * the remaining time up to the existing hard deadline. A buffered request
     * physically dispatched before the soft deadline may finish up to the hard
     * deadline, but cannot continue to tools、fallback or another ordinary turn.
     */
    finalizationReserveMs?: number;
    /** Content-free boundary signal for local runtime calibration. */
    onFinalizationReserve?: (event: {
        stage: "entered" | "completed" | "aborted" | "failed" | "exhausted" | "overrun";
        remainingMs: number;
    }) => void;
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
    /**
     * Optional per-turn admission seam for hosts such as Pagelet. The lease is
     * held from turn_start through turn_end and released before host policy may
     * continue to the next turn.
     */
    turnLeaseProvider?: PaAgentTurnLeaseProvider;
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

class ProviderPreparationDeadlineError extends Error {
    constructor(readonly reason: "finalization_reserve_reached" | "wall_clock_exceeded") {
        super(reason);
        this.name = "ProviderPreparationDeadlineError";
    }
}

const FINALIZATION_RESERVE_RUNTIME_INSTRUCTION = [
    "The ordinary turn deadline has been reached.",
    "This is the single reserved finalization turn; do not call tools.",
    "Use only existing observations and available context to answer.",
    "If evidence is unavailable or insufficient, say so directly without inferring it.",
].join(" ");

export class PaAgentLoop {
    private readonly events: AgentLifecycleEventEmitter;
    private readonly now: () => number;
    private readonly createId: (prefix: string) => string;
    private readonly maxTurns: number;
    private readonly assistantIdleTimeoutMs: number;
    private readonly remoteAttemptTimeoutMs: number;
    private readonly providerResponseDelivery: 'incremental' | 'buffered';
    private readonly maxWallClockMs: number;
    private readonly finalizationReserveMs: number;
    private readonly runStartedAt: number;
    private readonly startupTimings: readonly PaAgentTimingEntry[];
    private readonly transcript: PaAgentMessage[] = [];
    private readonly turns: PaAgentTurnSummary[] = [];
    private readonly dispatcher: ToolExecutionDispatcher;
    private committedFinalText = "";
    private endPayload?: Record<string, unknown>;
    private endStatus?: AgentEndStatus;
    private activeTurnToolMode?: PaAgentToolMode;
    private readonly providerNoProgressCounts = new Map<string, number>();
    private nativeWritingNoProgressCount = 0;

    constructor(private readonly options: PaAgentLoopOptions) {
        this.now = options.now ?? Date.now;
        this.createId = options.createId ?? createIncrementingIdFactory();
        this.maxTurns = options.maxTurns ?? 256;
        this.providerResponseDelivery = options.providerResponseDelivery ?? "incremental";
        this.assistantIdleTimeoutMs = options.assistantIdleTimeoutMs ?? Number.POSITIVE_INFINITY;
        this.remoteAttemptTimeoutMs = options.remoteAttemptTimeoutMs ?? 1_800_000;
        this.maxWallClockMs = options.maxWallClockMs ?? Number.POSITIVE_INFINITY;
        this.finalizationReserveMs = normalizeFinalizationReserveMs(
            options.finalizationReserveMs,
            this.maxWallClockMs,
        );
        this.runStartedAt = options.runStartedAt ?? this.now();
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
            toolTimeoutMs: options.toolTimeoutMs ?? this.remoteAttemptTimeoutMs,
            toolTimeoutOutcome: options.toolTimeoutOutcome ?? "recoverable_error",
            toolAbortGraceMs: options.toolAbortGraceMs ?? 2_000,
            maxToolCalls: options.maxToolCalls ?? 1024,
            now: this.now,
            isAborted: () => this.isAborted(),
            isWallClockExceeded: () => this.isTurnDeadlineExceeded(this.activeTurnToolMode),
            wallClockRemainingMs: () => this.turnDeadlineRemainingMs(this.activeTurnToolMode),
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
        let finalizationTurnRequested = false;
        let nextTurnIsLoopReservedFinal = false;
        let unobservedFinalizationTurnSummary: PaAgentTurnSummary | undefined;
        let allowEmptyReservedFinalResponse = false;
        let finalizationReserveTerminalReported = false;
        const reportFinalizationReserve = (
            stage: "entered" | "completed" | "aborted" | "failed" | "exhausted" | "overrun",
        ): void => {
            if (stage !== "entered" && finalizationReserveTerminalReported) return;
            if (stage !== "entered") finalizationReserveTerminalReported = true;
            try {
                this.options.onFinalizationReserve?.({
                    stage,
                    remainingMs: this.wallClockRemainingMs() ?? 0,
                });
            } catch {
                // Calibration must never change loop behavior.
            }
        };
        const resolveFinalizationTurnPreparation = (summary: PaAgentTurnSummary) => {
            const baseInstruction = this.options.nativeWriting
                ? this.options.nativeWriting.finalizationInstruction
                : FINALIZATION_RESERVE_RUNTIME_INSTRUCTION;
            const defaultRuntimeInstruction = this.options.allowTaskIncompleteReport
                ? `${baseInstruction} The sole exception is a single ${REPORT_TASK_INCOMPLETE} pure output call when the user task cannot be completed; include the user-facing explanation in its answer field.`
                : baseInstruction;
            const defaultControlSnapshot = deriveContinuedAgentControlSnapshot(summary.controlSnapshot, {
                runtimeInstruction: defaultRuntimeInstruction,
                toolMode: "final_answer_only",
            });
            let preparation: PaAgentFinalizationTurnPreparation | undefined;
            try {
                preparation = this.options.hostPolicy?.prepareFinalizationTurn?.(summary, {
                    defaultRuntimeInstruction,
                    ...(defaultControlSnapshot ? { defaultControlSnapshot } : {}),
                });
            } catch (error) {
                summary.diagnostics.push({
                    type: "finalization_policy_preparation_error",
                    message: errorMessage(error),
                });
            }
            return { defaultRuntimeInstruction, preparation };
        };
        const scheduleReservedFinalTurn = (summary: PaAgentTurnSummary): boolean => {
            if (finalizationTurnRequested) return false;
            finalizationTurnRequested = true;
            nextTurnIsLoopReservedFinal = true;
            unobservedFinalizationTurnSummary = summary;
            const { defaultRuntimeInstruction, preparation } = resolveFinalizationTurnPreparation(summary);
            nextRuntimeInstruction = preparation?.runtimeInstruction ?? defaultRuntimeInstruction;
            nextToolMode = "final_answer_only";
            allowEmptyReservedFinalResponse = preparation?.allowEmptyResponse === true;
            nextControlSnapshot = deriveContinuedAgentControlSnapshot(
                preparation?.controlSnapshot ?? summary.controlSnapshot,
                {
                runtimeInstruction: nextRuntimeInstruction,
                toolMode: nextToolMode,
                },
            );
            reportFinalizationReserve("entered");
            return true;
        };
        const requestReservedFinalTurn = (
            turnIndex: number,
        ): Promise<PaAgentLoopResult | undefined> => {
            const summary = this.createFinalizationReserveSummary(
                turnIndex,
                nextControlSnapshot,
            );
            if (scheduleReservedFinalTurn(summary)) return Promise.resolve(undefined);
            reportFinalizationReserve("exhausted");
            this.endAgent("incomplete", {
                reason: "finalization_reserve_exhausted",
                diagnostics: summary.diagnostics,
            });
            return Promise.resolve(this.createResult("incomplete"));
        };

        let leaseSequence = 0;
        for (let turnIndex = 0; turnIndex < this.maxTurns; turnIndex++) {
            let turnSummary: PaAgentTurnSummary;
            let loopReservedFinalTurn = false;
            let committedTextBeforeTurn = this.committedFinalText;
            while (true) {
                if (this.isAborted()) {
                    if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("aborted");
                    this.endAgent("aborted", { reason: "user_abort" });
                    return this.createResult("aborted");
                }
                if (this.isWallClockExceeded()) {
                    if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("exhausted");
                    this.endAgent("incomplete", {
                        reason: "wall_clock_exceeded",
                        maxWallClockMs: this.maxWallClockMs,
                    });
                    return this.createResult("incomplete");
                }

                if (this.isFinalizationReserveReached(nextToolMode)) {
                    const stopped = await requestReservedFinalTurn(turnIndex);
                    if (stopped) return stopped;
                }

                let turnLease: AgentRunLease | undefined;
                const debugLeaseId = this.options.turnLeaseProvider ? `${this.options.runId}:lease:${++leaseSequence}` : undefined;
                const leaseWait = this.options.turnLeaseProvider
                    ? this.createTurnLeaseWaitScope(nextToolMode)
                    : undefined;
                try {
                    if (debugLeaseId) this.debug('turn_lease:start', { leaseId: debugLeaseId, turnIndex });
                    turnLease = await this.options.turnLeaseProvider?.({
                        runId: this.options.runId,
                        turnIndex,
                        signal: leaseWait?.signal ?? this.options.signal,
                    });
                    if (debugLeaseId) this.debug('turn_lease:end', { leaseId: debugLeaseId, turnIndex });
                } catch (error) {
                    if (debugLeaseId) this.debug('turn_lease:error', { leaseId: debugLeaseId, turnIndex });
                    const deadlineReason = leaseWait?.deadlineReason();
                    if (deadlineReason === "finalization_reserve_reached") {
                        const stopped = await requestReservedFinalTurn(turnIndex);
                        if (stopped) return stopped;
                        continue;
                    }
                    if (deadlineReason === "wall_clock_exceeded") {
                        if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("exhausted");
                        this.endAgent("incomplete", {
                            reason: "wall_clock_exceeded",
                            maxWallClockMs: this.maxWallClockMs,
                        });
                        return this.createResult("incomplete");
                    }
                    if (isAbortError(error, leaseWait?.signal ?? this.options.signal)) {
                        if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("aborted");
                        this.endAgent("aborted", { reason: "user_abort" });
                        return this.createResult("aborted");
                    }
                    this.endAgent("error", {
                        reason: "turn_lease_error",
                        diagnostics: [{
                            type: "turn_lease_error",
                            message: errorMessage(error),
                        }],
                    });
                    if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("failed");
                    return this.createResult("error");
                } finally {
                    leaseWait?.dispose();
                }

                if (this.isAborted()) {
                    if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("aborted");
                    turnLease?.release();
                    this.endAgent("aborted", { reason: "user_abort" });
                    return this.createResult("aborted");
                }
                if (this.isWallClockExceeded()) {
                    if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("exhausted");
                    turnLease?.release();
                    this.endAgent("incomplete", {
                        reason: "wall_clock_exceeded",
                        maxWallClockMs: this.maxWallClockMs,
                    });
                    return this.createResult("incomplete");
                }
                if (this.isFinalizationReserveReached(nextToolMode)) {
                    turnLease?.release();
                    const stopped = await requestReservedFinalTurn(turnIndex);
                    if (stopped) return stopped;
                    continue;
                }

                try {
                    this.activeTurnToolMode = nextToolMode;
                    loopReservedFinalTurn = nextTurnIsLoopReservedFinal
                        && nextToolMode === "final_answer_only";
                    committedTextBeforeTurn = this.committedFinalText;
                    turnSummary = await this.runTurn(
                        turnIndex,
                        nextRuntimeInstruction,
                        nextToolMode,
                        nextControlSnapshot,
                        debugLeaseId,
                    );
                    if (loopReservedFinalTurn) nextTurnIsLoopReservedFinal = false;
                } finally {
                    this.activeTurnToolMode = undefined;
                    turnLease?.release();
                }
                break;
            }

            this.turns.push(turnSummary);
            nextRuntimeInstruction = undefined;
            nextToolMode = undefined;
            nextControlSnapshot = undefined;

            if (turnSummary.status === "error" && this.isRecoverableProviderTurn(turnSummary)) {
                const recovery = this.providerRecoveryInstruction(turnSummary);
                if (recovery) {
                    nextRuntimeInstruction = recovery;
                    nextToolMode = "normal";
                    nextControlSnapshot = deriveContinuedAgentControlSnapshot(turnSummary.controlSnapshot, {
                        runtimeInstruction: recovery,
                        toolMode: "normal",
                    });
                    await this.waitForProviderRetry(turnSummary);
                    continue;
                }
                this.endAgent("incomplete", {
                    reason: "provider_no_progress",
                    diagnostics: turnSummary.diagnostics,
                });
                return this.createResult("incomplete");
            }

            if (turnSummary.status === "aborted" || turnSummary.status === "error") {
                if (loopReservedFinalTurn) {
                    reportFinalizationReserve(turnSummary.status === "aborted" ? "aborted" : "failed");
                }
                const status = this.agentStatusFromTurn(turnSummary.status);
                this.endAgent(status, {
                    reason: turnSummary.status,
                    diagnostics: turnSummary.diagnostics,
                });
                return this.createResult(status);
            }

            if (turnSummary.diagnostics.some(diagnostic => diagnostic.type === "assistant_source_changed")) {
                if (loopReservedFinalTurn) reportFinalizationReserve("failed");
                this.endAgent("incomplete", { reason: "assistant_source_changed", diagnostics: turnSummary.diagnostics });
                return this.createResult("incomplete");
            }

            if (turnSummary.agentReportedIncomplete) {
                if (loopReservedFinalTurn) reportFinalizationReserve("failed");
                this.endAgent("incomplete", { reason: "agent_reported_incomplete" });
                return this.createResult("incomplete");
            }

            if (turnSummary.diagnostics.some((diagnostic) => diagnostic.type === "provider_attempt_timeout")) {
                const recovery = this.providerRecoveryInstruction(turnSummary);
                if (recovery) {
                    nextRuntimeInstruction = recovery;
                    nextToolMode = "normal";
                    nextControlSnapshot = deriveContinuedAgentControlSnapshot(turnSummary.controlSnapshot, {
                        runtimeInstruction: recovery,
                        toolMode: "normal",
                    });
                    await this.waitForProviderRetry(turnSummary);
                    continue;
                }
                this.endAgent("incomplete", {
                    reason: "provider_no_progress",
                    diagnostics: turnSummary.diagnostics,
                });
                return this.createResult("incomplete");
            }

            if (turnSummary.nativeWritingAttempted) {
                if (!turnSummary.nativeWriting) {
                    if (!this.isNativeWritingCurrent()) {
                        const diagnostics = [
                            ...turnSummary.diagnostics,
                            { type: "assistant_source_changed", message: "Writing sources changed before delivery." },
                        ];
                        this.endAgent("incomplete", {
                            reason: "assistant_source_changed",
                            diagnostics,
                        });
                        return this.createResult("incomplete");
                    }
                    this.nativeWritingNoProgressCount += 1;
                    if (this.nativeWritingNoProgressCount < 4) {
                        const outputDomain = this.options.nativeWriting;
                        if (!outputDomain) {
                            this.endAgent("incomplete", { reason: "output_domain_unavailable" });
                            return this.createResult("incomplete");
                        }
                        const runtimeInstruction = this.nativeWritingNoProgressCount >= 3
                            ? outputDomain.strategyChangeInstruction
                            : outputDomain.correctionInstruction;
                        nextRuntimeInstruction = runtimeInstruction;
                        nextToolMode = "normal";
                        nextControlSnapshot = deriveContinuedAgentControlSnapshot(turnSummary.controlSnapshot, {
                            runtimeInstruction,
                            toolMode: "normal",
                        });
                        continue;
                    }
                    this.endAgent("incomplete", {
                        reason: "native_writing_no_progress",
                        diagnostics: turnSummary.diagnostics,
                    });
                    return this.createResult("incomplete");
                }
                const fallback: PaAgentTerminalDecision = {
                    action: "stop",
                    status: turnSummary.nativeWriting ? this.agentStatusFromTurn(turnSummary.status) : "incomplete",
                    reason: turnSummary.nativeWriting ? "native_writing_output" : "native_writing_invalid",
                    diagnostics: turnSummary.diagnostics,
                };
                const hostDecision = loopReservedFinalTurn
                    ? await this.decideFinalizationAfterTurn(turnSummary, fallback, unobservedFinalizationTurnSummary, true)
                    : await this.decideAfterTurn(turnSummary);
                const decision = mergeTerminalDecisions(fallback, hostDecision.action === "continue"
                    ? { action: "stop", status: "incomplete", reason: "native_writing_policy_requested_continuation" }
                    : { ...hostDecision, status: hostDecision.status ?? fallback.status });
                const status = this.isAborted() ? "aborted"
                    : !this.isNativeWritingCurrent() ? "incomplete" : decision.status;
                if (loopReservedFinalTurn) reportFinalizationReserve(status === "completed" ? "completed" : "failed");
                this.endAgent(status, { reason: decision.reason,
                    ...(decision.warnings ? { warnings: decision.warnings } : {}),
                    ...(decision.diagnostics ? { diagnostics: decision.diagnostics } : {}),
                });
                return this.createResult(status);
            }

            if (turnSummary.diagnostics.some((diagnostic) => (
                diagnostic.type === "finalization_reserve_exhausted_by_buffered_provider"
            ))) {
                reportFinalizationReserve("entered");
                reportFinalizationReserve("exhausted");
                this.endAgent("incomplete", {
                    reason: "wall_clock_exceeded",
                    maxWallClockMs: this.maxWallClockMs,
                    diagnostics: turnSummary.diagnostics,
                });
                return this.createResult("incomplete");
            }

            if (turnSummary.diagnostics.some((diagnostic) => (
                diagnostic.type === "finalization_reserve_overrun"
            ))) {
                reportFinalizationReserve("entered");
                reportFinalizationReserve("overrun");
                const producedFinalText = turnSummary.toolCalls.length === 0
                    && turnSummary.committedFinalText.slice(committedTextBeforeTurn.length).trim().length > 0;
                const acceptedEmptyResponse = !producedFinalText
                    && isEmptyBufferedFinalizationOverrun(turnSummary)
                    && resolveFinalizationTurnPreparation(turnSummary).preparation?.allowEmptyResponse === true;
                const status: AgentEndStatus = producedFinalText || acceptedEmptyResponse
                    ? "completed_with_warning"
                    : "incomplete";
                if (producedFinalText || acceptedEmptyResponse) {
                    const decision = await this.decideFinalizationAfterTurn(turnSummary, {
                        action: "stop",
                        status,
                        reason: "finalization_reserve_overrun",
                        diagnostics: turnSummary.diagnostics,
                    });
                    this.endAgent(decision.status, {
                        reason: decision.reason,
                        ...(decision.warnings ? { warnings: decision.warnings } : {}),
                        ...(decision.diagnostics ? { diagnostics: decision.diagnostics } : {}),
                    });
                    return this.createResult(decision.status);
                }
                this.endAgent(status, {
                    reason: "finalization_reserve_overrun",
                    diagnostics: turnSummary.diagnostics,
                });
                return this.createResult(status);
            }

            if (turnSummary.diagnostics.some((diagnostic) => (
                diagnostic.type === "finalization_reserve_used_by_text"
            ))) {
                const decision = await this.decideFinalizationAfterTurn(turnSummary, {
                    action: "stop",
                    status: this.agentStatusFromTurn(turnSummary.status),
                    reason: "finalization_reserve_used_by_text",
                    diagnostics: turnSummary.diagnostics,
                }, undefined, true);
                this.endAgent(decision.status, {
                    reason: decision.reason,
                    ...(decision.warnings ? { warnings: decision.warnings } : {}),
                    ...(decision.diagnostics ? { diagnostics: decision.diagnostics } : {}),
                });
                return this.createResult(decision.status);
            }

            if (loopReservedFinalTurn) {
                const producedFinalText = turnSummary.toolCalls.length === 0
                    && turnSummary.committedFinalText.slice(committedTextBeforeTurn.length).trim().length > 0;
                const acceptedEmptyResponse = allowEmptyReservedFinalResponse
                    && isOrdinaryEmptyFinalizationResponse(turnSummary);
                if (producedFinalText || acceptedEmptyResponse) {
                    reportFinalizationReserve("completed");
                    const status = acceptedEmptyResponse
                        ? "completed" as const
                        : this.agentStatusFromTurn(turnSummary.status);
                    const decision = await this.decideFinalizationAfterTurn(turnSummary, {
                        action: "stop",
                        status,
                        reason: acceptedEmptyResponse
                            ? "finalization_reserve_empty_response_accepted"
                            : "finalization_reserve_completed",
                    }, unobservedFinalizationTurnSummary);
                    this.endAgent(decision.status, {
                        reason: decision.reason,
                        ...(decision.warnings ? { warnings: decision.warnings } : {}),
                        ...(decision.diagnostics ? { diagnostics: decision.diagnostics } : {}),
                    });
                    return this.createResult(decision.status);
                }
                const diagnostics = [
                    ...turnSummary.diagnostics,
                    ...(turnSummary.toolCalls.length > 0
                        ? [{
                            type: "final_answer_only_violation",
                            message: "The reserved final-answer turn attempted a tool call.",
                            toolNames: turnSummary.toolCalls.flatMap((part) => (
                                part.type === "toolCall" ? [part.name] : []
                            )),
                        }]
                        : []),
                ];
                this.endAgent("incomplete", {
                    reason: "finalization_reserve_exhausted",
                    ...(diagnostics.length > 0 ? { diagnostics } : {}),
                });
                reportFinalizationReserve("exhausted");
                return this.createResult("incomplete");
            }

            if (
                turnSummary.status === "incomplete"
                && turnSummary.diagnostics.some((diagnostic) => (
                    diagnostic.type === "finalization_reserve_reached"
                ))
                && scheduleReservedFinalTurn(turnSummary)
            ) {
                continue;
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

        if (nextTurnIsLoopReservedFinal) reportFinalizationReserve("exhausted");
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
        debugLeaseId?: string,
    ): Promise<PaAgentTurnSummary> {
        // A handle prepared during this response cannot authorize its own output.
        let nativeContextHandle: string | undefined;
        try {
            const writing = this.options.nativeWriting;
            nativeContextHandle = writing?.getContextHandle ? writing.getContextHandle() : writing?.contextHandle;
        } catch { /* Unavailable host context grants no output authority. */ }
        if (!this.options.nativeWriting?.isValidContextHandle(nativeContextHandle)) nativeContextHandle = undefined;
        // Recompute from the host run contract on each turn rather than inheriting
        // model data or treating a source-tool allowlist as output authority.
        if (this.options.nativeWriting && nativeContextHandle !== undefined) {
            controlSnapshot = {
                ...(controlSnapshot ?? createAgentControlSnapshot()),
                writingOutput: this.options.nativeWriting.outputName,
            };
        } else if (controlSnapshot?.writingOutput) {
            controlSnapshot = { ...controlSnapshot };
            delete controlSnapshot.writingOutput;
        }
        const turnAbort = this.createTurnAbortScope();
        const turnStartedAt = this.now();
        const turnId = this.createId("turn");
        if (debugLeaseId) this.debug('turn_lease_bound', { leaseId: debugLeaseId, turnId, turnIndex });
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
            ...(this.options.writingRequest ? { writingRequestId: this.options.writingRequest.requestId } : {}),
            id: this.createId("message_assistant"),
            content: [],
            timestamp: this.now(),
        };
        this.events.messageStart(turnId, assistantMessage);

        let sawThinking = false;
        let sawText = false;
        let sawToolCall = false;
        let pendingText = "";
        let hasPendingAnswerText = false;
        let pendingTextReclassified = false;
        const toolCallBuffers: BufferedToolCall[] = [];
        const modelStartedAt = this.now();
        let firstModelChunkElapsedMs: number | undefined;
        let modelChunkCount = 0;
        let providerRequestStarted = false;
        let providerRequestStartedAt: number | undefined;
        let textUsesHardDeadline = false;
        let providerPreparationDeadlineReason:
            | "finalization_reserve_reached"
            | "wall_clock_exceeded"
            | undefined;
        const providerRequestDeadlineListeners = new Set<() => void>();
        const notifyProviderRequestStarted = (): void => {
            if (this.isTurnDeadlineExceeded(toolMode)) {
                const reason = this.isWallClockExceeded()
                    ? "wall_clock_exceeded" as const
                    : "finalization_reserve_reached" as const;
                providerPreparationDeadlineReason = reason;
                turnAbort.abort();
                throw new ProviderPreparationDeadlineError(reason);
            }
            providerRequestStarted = true;
            providerRequestStartedAt = this.now();
            this.debug('provider_request_admitted', { turnId });
            for (const listener of providerRequestDeadlineListeners) listener();
        };
        const notifyProviderRequestFailed = (): void => {
            providerRequestStartedAt = undefined;
            this.debug('provider_request_failed', { turnId });
            for (const listener of providerRequestDeadlineListeners) listener();
        };

        let modelInput: PaAgentModelInput = {
            runId: this.options.runId,
            turnId,
            turnIndex,
            userInput: this.options.userInput,
            transcript: [...this.transcript],
            ...(this.options.hostContext ? { hostContext: this.options.hostContext } : {}),
            runtimeInstruction,
            toolMode,
            controlSnapshot,
            signal: turnAbort.signal,
            notifyProviderRequestStarted,
            notifyProviderRequestFailed,
        };
        let terminalStatus: TurnEndStatus | undefined;
        let stopReason: "stop" | "tool_calls" | "error" | "aborted" | "idle_timeout" | "wall_clock_exceeded" | undefined;
        const diagnostics: Array<Record<string, unknown>> = [];
        const metrics: Array<Record<string, unknown>> = [];
        const nativeCollector = this.options.nativeWriting
            ? this.options.nativeWriting.createCollector(
                nativeContextHandle ?? "",
                this.options.nativeWriting.maxTextChars,
            )
            : undefined;

        let iterator: AsyncIterator<PaAgentModelStreamChunk> | undefined;
        let inputPreparationCompleted = !this.options.prepareModelInput;
        try {
            if (this.options.prepareModelInput) {
                this.debug('loop_input_prepare:start', { turnId });
                modelInput = await this.prepareModelInputForProvider(
                    modelInput,
                    toolMode,
                    (reason) => {
                        providerPreparationDeadlineReason = reason;
                        turnAbort.abort();
                    },
                );
                inputPreparationCompleted = true;
                this.debug('loop_input_prepare:end', { turnId });
                const prepareForProviderRetry = async (): Promise<PaAgentModelInput> => {
                    const baseInput = { ...modelInput };
                    delete baseInput.prepareForProviderRetry;
                    const refreshed = await this.prepareModelInputForProvider(
                        baseInput,
                        toolMode,
                        (reason) => {
                            providerPreparationDeadlineReason = reason;
                            turnAbort.abort();
                        },
                    );
                    modelInput = { ...refreshed, prepareForProviderRetry };
                    return modelInput;
                };
                modelInput = { ...modelInput, prepareForProviderRetry };
            }
            if (turnAbort.signal.aborted || this.isAborted()) {
                throw createAbortError();
            }
            iterator = this.options.model.stream(modelInput)[Symbol.asyncIterator]();
            if (!this.options.model.reportsProviderRequestStart) notifyProviderRequestStarted();
        } catch (error) {
            if (error instanceof ProviderPreparationDeadlineError) {
                stopReason = "wall_clock_exceeded";
                terminalStatus = "incomplete";
                diagnostics.push(this.deadlineDiagnostic(error.reason));
            } else if (isAbortError(error, turnAbort.signal)) {
                stopReason = "aborted";
                terminalStatus = "aborted";
                diagnostics.push({ type: "user_abort" });
            } else {
                stopReason = "error";
                terminalStatus = "error";
                diagnostics.push(inputPreparationCompleted
                    ? providerErrorDiagnostic(error)
                    : { type: "model_input_preparation_error", message: "Model input could not be prepared safely." });
            }
        }

        const consumer = iterator
            ? new ModelChunkConsumer(iterator, {
                signal: turnAbort.signal,
                assistantIdleTimeoutMs: this.assistantIdleTimeoutMs,
                isIdleTimeoutEnabled: () => this.providerResponseDelivery !== "buffered"
                    && (!this.options.model.reportsProviderRequestStart || providerRequestStarted),
                subscribeIdleTimeoutChange: (listener) => {
                    providerRequestDeadlineListeners.add(listener);
                    return () => providerRequestDeadlineListeners.delete(listener);
                },
                isAborted: () => this.isAborted(),
                isWallClockExceeded: () => this.isRemoteAttemptExceeded(providerRequestStartedAt)
                    || (textUsesHardDeadline ? this.isWallClockExceeded() : this.isProviderWaitDeadlineExceeded(
                        toolMode,
                        providerRequestStarted,
                    )),
                wallClockRemainingMs: () => minimumDefined(
                    this.remoteAttemptRemainingMs(providerRequestStartedAt),
                    textUsesHardDeadline ? this.wallClockRemainingMs() : this.providerWaitDeadlineRemainingMs(
                        toolMode,
                        providerRequestStarted,
                    ),
                ),
                subscribeWallClockDeadlineChange: (listener) => {
                    providerRequestDeadlineListeners.add(listener);
                    return () => providerRequestDeadlineListeners.delete(listener);
                },
            })
            : undefined;
        this.debug('model_wait:start', { turnId, idleTimeoutMs: Number.isFinite(this.assistantIdleTimeoutMs) ? this.assistantIdleTimeoutMs : null,
            providerRequestStarted });

        let completedTextAt: number | undefined;
        let completedOutputAt: number | undefined;
        let transportOutcome = "unknown";
        while (consumer) {
            const next = await consumer.nextChunk();
            if (next.type !== "chunk") transportOutcome = next.type;
            if (next.type !== 'chunk') this.debug('model_wait:end', { turnId, outcome: next.type,
                providerRequestStarted, modelChunkCount, elapsedMs: elapsedSince(modelStartedAt, this.now()) });
            if (next.type === "done") {
                break;
            }
            // A normal provider finish proves the preceding text phase ended.
            // Failure to receive optional usage/EOF is a transport outcome, not
            // evidence that this already completed text became partial. Tool
            // phases require separate admission and deliberately do not use this.
            if (
                completedTextAt !== undefined
                && !this.isAborted()
                && (next.type === "error" || next.type === "idle" || next.type === "wall_clock_exceeded")
            ) {
                turnAbort.abort();
                stopReason = "stop";
                metrics.push({
                    type: "provider_transport_end",
                    outcome: next.type,
                    contentCompletedAt: completedTextAt,
                });
                break;
            }
            if (next.type === "idle") {
                turnAbort.abort();
                stopReason = "idle_timeout";
                terminalStatus = hasPendingAnswerText ? "completed_with_warning" : "incomplete";
                diagnostics.push({ type: "assistant_idle_timeout", timeoutMs: this.assistantIdleTimeoutMs });
                break;
            }
            if (next.type === "aborted") {
                if (providerPreparationDeadlineReason) {
                    stopReason = "wall_clock_exceeded";
                    terminalStatus = "incomplete";
                    diagnostics.push(this.deadlineDiagnostic(providerPreparationDeadlineReason));
                } else {
                    stopReason = "aborted";
                    terminalStatus = "aborted";
                    diagnostics.push({ type: "user_abort" });
                }
                break;
            }
            if (next.type === "wall_clock_exceeded") {
                turnAbort.abort();
                stopReason = "wall_clock_exceeded";
                const diagnostic = this.isRemoteAttemptExceeded(providerRequestStartedAt)
                    ? { type: "provider_attempt_timeout", timeoutMs: this.remoteAttemptTimeoutMs }
                    : this.turnDeadlineDiagnostic(toolMode);
                const reserveReached = diagnostic.type === "finalization_reserve_reached";
                terminalStatus = reserveReached
                    ? "incomplete"
                    : (hasPendingAnswerText ? "completed_with_warning" : "incomplete");
                if (reserveReached && pendingText.length > 0) {
                    pendingTextReclassified = true;
                    reclassifyTextPartsAsThinking(assistantMessage.content);
                }
                diagnostics.push(diagnostic);
                break;
            }
            if (next.type === "error") {
                turnAbort.abort();
                if (next.error instanceof ProviderPreparationDeadlineError) {
                    stopReason = "wall_clock_exceeded";
                    terminalStatus = "incomplete";
                    diagnostics.push(this.deadlineDiagnostic(next.error.reason));
                } else {
                    stopReason = "error";
                    terminalStatus = hasPendingAnswerText ? "completed_with_warning" : "error";
                    diagnostics.push(providerErrorDiagnostic(next.error));
                }
                break;
            }

            const chunk = next.chunk;
            if (chunk.type === "diagnostic") {
                metrics.push(chunk.diagnostic);
                continue;
            }
            if (chunk.type === "provider_completion") {
                if (assistantMessage.providerCompletion !== undefined && assistantMessage.providerCompletion !== chunk.completion) {
                    stopReason = "error";
                    terminalStatus = hasPendingAnswerText ? "completed_with_warning" : "error";
                    diagnostics.push({ type: "provider_completion_conflict" });
                    turnAbort.abort();
                    break;
                }
                assistantMessage.providerCompletion = chunk.completion;
                if (chunk.completion === "stop" && hasPendingAnswerText && !sawToolCall) {
                    completedTextAt ??= this.now();
                }
                if (chunk.completion === "tool_calls" && nativeCollector?.decode() && this.isNativeWritingCurrent()) {
                    completedOutputAt ??= this.now();
                    // Pure output has no execution/ack phase. Stop consuming the
                    // optional tail now so Host Policy keeps the remaining hard
                    // budget. Unobserved EOF/usage is not recorded as successful.
                    try { void Promise.resolve(iterator?.return?.()).catch(() => undefined); }
                    catch { /* Closing an already finished producer cannot change its content facts. */ }
                    break;
                }
                continue;
            }
            if (assistantMessage.providerCompletion !== undefined) {
                stopReason = "error";
                terminalStatus = hasPendingAnswerText ? "completed_with_warning" : "error";
                diagnostics.push({ type: "provider_content_after_completion" });
                turnAbort.abort();
                break;
            }
            if (chunk.type === "toolcall_delta" && nativeCollector) {
                nativeCollector.consume(chunk);
                if (nativeCollector.hasWritingCall && !nativeCollector.isCandidate) {
                    this.events.messageUpdate(turnId, assistantMessage.id, { kind: "toolcall_delta", text: "" }, {
                        nativeWritingContextHandle: nativeContextHandle,
                        nativeWritingArguments: "",
                    });
                    terminalStatus = "incomplete";
                    diagnostics.push({ type: "native_writing_identity_or_batch_invalid" });
                    turnAbort.abort();
                    break;
                }
            }
            if (chunk.type === "toolcall_delta" && textUsesHardDeadline && !nativeCollector?.isCandidate
                && this.isFinalizationReserveReached(toolMode)) {
                // Tool preparation can stage an action. Reject before buffering,
                // not merely before execute, once only text reception is allowed.
                stopReason = "error";
                terminalStatus = "completed_with_warning";
                diagnostics.push({ type: "late_tool_after_text", toolName: chunk.name });
                turnAbort.abort();
                break;
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
                    // Test for meaningful text without altering the provider's exact whitespace.
                    hasPendingAnswerText ||= chunk.text.trim().length > 0;
                    if (!textUsesHardDeadline && !sawToolCall && hasPendingAnswerText
                        && this.providerResponseDelivery !== "buffered"
                        && this.usesFinalizationReserve(toolMode)) {
                        // Finish this already visible response within the original
                        // hard budget. Tool admission retains its soft deadline.
                        textUsesHardDeadline = true;
                        for (const listener of providerRequestDeadlineListeners) listener();
                    }
                    appendTextPart(assistantMessage.content, sawToolCall && !nativeCollector ? "thinking" : "text", chunk.text);
                    this.events.messageUpdate(turnId, assistantMessage.id, { kind: "text_delta", text: chunk.text });
                    break;
                case "toolcall_delta": {
                    const outputUsesHardDeadline = nativeCollector?.isCandidate === true;
                    if (textUsesHardDeadline !== outputUsesHardDeadline) {
                        textUsesHardDeadline = outputUsesHardDeadline;
                        for (const listener of providerRequestDeadlineListeners) listener();
                    }
                    sawToolCall = true;
                    if (pendingText.length > 0 && !nativeCollector) {
                        pendingTextReclassified = true;
                        reclassifyTextPartsAsThinking(assistantMessage.content);
                    }
                    const { buffer, isNew } = upsertToolCallBuffer(
                        toolCallBuffers,
                        assistantMessage.content,
                        chunk,
                        this.createId,
                    );
                    const sourceIndex = nativeCollector?.providerIdentity?.index;
                    if (sourceIndex !== undefined) {
                        buffer.index = sourceIndex;
                        const part = assistantMessage.content[buffer.partIndex];
                        if (part.type === "toolCall") part.index = sourceIndex;
                    }
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
                    }, nativeCollector?.isCandidate ? {
                        nativeWritingContextHandle: nativeContextHandle,
                        nativeWritingArguments: nativeCollector.rawArguments,
                    } : undefined);
                    break;
                }
            }
        }

        if (textUsesHardDeadline
            && (completedTextAt ?? this.now()) - this.runStartedAt >= this.maxWallClockMs - this.finalizationReserveMs) {
            diagnostics.push({
                type: "finalization_reserve_used_by_text",
                finalizationReserveMs: this.finalizationReserveMs,
                remainingMs: this.wallClockRemainingMs() ?? 0,
            });
        }

        const bufferedContentOverranReserve = completedTextAt !== undefined
            && this.usesBufferedProviderHardDeadline(toolMode, providerRequestStarted)
            && completedTextAt - this.runStartedAt >= this.maxWallClockMs - this.finalizationReserveMs;
        if (
            terminalStatus === undefined && completedOutputAt === undefined
            && (bufferedContentOverranReserve || (
                completedTextAt === undefined
                && this.didBufferedProviderOverrunFinalizationReserve(toolMode, providerRequestStarted)
            ))
        ) {
            terminalStatus = toolCallBuffers.length === 0 && hasPendingAnswerText
                ? "completed_with_warning"
                : "incomplete";
            diagnostics.push({
                type: "finalization_reserve_overrun",
                providerResponseDelivery: "buffered",
                finalizationReserveMs: this.finalizationReserveMs,
                remainingMs: this.wallClockRemainingMs() ?? 0,
                reservePreserved: false,
            });
        } else if (
            completedTextAt === undefined
            && this.usesBufferedProviderHardDeadline(toolMode, providerRequestStarted)
            && this.isWallClockExceeded()
        ) {
            diagnostics.push({
                type: "finalization_reserve_exhausted_by_buffered_provider",
                providerResponseDelivery: "buffered",
                finalizationReserveMs: this.finalizationReserveMs,
                remainingMs: 0,
                reservePreserved: false,
            });
        }

        if (sawThinking) {
            this.events.messageUpdate(turnId, assistantMessage.id, { kind: "thinking_end" });
        }
        if (sawText) {
            this.events.messageUpdate(turnId, assistantMessage.id, { kind: "text_end" });
        }
        canonicalizeBufferedToolCallParts(toolCallBuffers, assistantMessage.content);
        for (const buffer of toolCallBuffers) {
            this.events.messageUpdate(turnId, assistantMessage.id, {
                kind: "toolcall_end",
                toolCallId: buffer.id,
                index: buffer.index,
            });
        }

        const toolCalls = toolCallBuffers.map((buffer) => assistantMessage.content[buffer.partIndex]).filter(isToolCallPart);
        const hasToolCall = toolCalls.length > 0;
        const mayReportIncomplete = typeof this.options.allowTaskIncompleteReport === 'function'
            ? this.options.allowTaskIncompleteReport(runtimeInstruction)
            : this.options.allowTaskIncompleteReport === true;
        const incompleteReportCall = mayReportIncomplete
            ? toolCalls.find(call => call.name === REPORT_TASK_INCOMPLETE) : undefined;
        const nativeWritingAttempted = nativeCollector?.hasWritingCall === true;
        if (!hasToolCall && assistantMessage.providerCompletion === "tool_calls"
            && terminalStatus !== "aborted" && terminalStatus !== "error") {
            terminalStatus = "incomplete";
            diagnostics.push({ type: "provider_tool_calls_missing" });
        }
        if (!hasToolCall && hasPendingAnswerText && this.options.isFinalTextCurrent) {
            if (!this.isFinalTextCurrent()) {
                if (terminalStatus !== "aborted" && terminalStatus !== "error") terminalStatus = "incomplete";
                diagnostics.push({ type: "assistant_source_changed" });
            }
        }
        const nativeWriting = nativeWritingAttempted && toolCalls.length === 1 && terminalStatus === undefined
            && assistantMessage.providerCompletion === "tool_calls" && !this.isAborted() && this.isNativeWritingCurrent()
            ? nativeCollector?.decode() : undefined;
        if (nativeWriting && toolCalls.length === 1) {
            toolCalls[0].name = this.options.nativeWriting!.outputName;
            toolCalls[0].input = nativeCollector!.rawArguments;
        }
        if (nativeCollector && hasToolCall && !nativeWriting && pendingText.length > 0) {
            pendingTextReclassified = true;
            reclassifyTextPartsAsThinking(assistantMessage.content);
        }
        if (nativeWritingAttempted && !nativeWriting && terminalStatus === undefined) {
            terminalStatus = "incomplete";
            diagnostics.push({ type: "native_writing_invalid" });
        }
        assistantMessage.stopReason = stopReason ?? (hasToolCall ? "tool_calls" : "stop");
        assistantMessage.providerCompletion ??= "unknown";
        const modelElapsedMs = elapsedSince(modelStartedAt, this.now());
        this.events.messageEnd(turnId, assistantMessage, {
            transportOutcome,
            ...(nativeWriting ? { nativeWritingContextHandle: nativeContextHandle,
                nativeWritingValidated: true } : {}),
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
        if (hasToolCall && terminalStatus === undefined && !nativeWritingAttempted && !incompleteReportCall) {
            const toolExecutionStartedAt = this.now();
            const execution = await this.dispatcher.executeBufferedToolCalls(
                turnId, turnIndex, toolCallBuffers, toolMode, controlSnapshot,
            );
            toolExecutionElapsedMs = elapsedSince(toolExecutionStartedAt, this.now());
            toolResults.push(...execution.toolResults);
            diagnostics.push(...execution.diagnostics);
            toolExecutionStoppedBy = execution.stoppedBy;
        } else if (hasToolCall && !nativeWritingAttempted && !incompleteReportCall) {
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
            diagnostics.push(this.turnDeadlineDiagnostic(toolMode));
        }
        let agentReportedIncomplete = false;
        if (incompleteReportCall && terminalStatus === undefined) {
            const answer = toolCalls.length === 1 && assistantMessage.providerCompletion === 'tool_calls'
                ? parseTaskIncompleteOutput(incompleteReportCall.input) : undefined;
            if (!answer) {
                diagnostics.push({ type: 'task_incomplete_report_invalid' });
            } else if (!this.isFinalTextCurrent()) {
                diagnostics.push({ type: 'assistant_source_changed' });
            } else {
                agentReportedIncomplete = true;
                this.committedFinalText += answer;
                this.options.onCommittedFinalText?.(this.committedFinalText);
            }
            terminalStatus = 'incomplete';
        }
        if (!hasToolCall && terminalStatus === undefined && !hasPendingAnswerText) {
            terminalStatus = "incomplete";
            diagnostics.push({
                type: "assistant_empty_response",
                message: sawThinking
                    ? "Assistant stream ended after thinking without final answer text."
                    : "Assistant stream ended without final answer text.",
            });
        }
        const status: TurnEndStatus = terminalStatus
            ?? (nativeWriting ? "completed" : hasToolCall ? (toolResults.length > 0 ? "tool_results_ready" : "incomplete") : "completed");

        if (!hasToolCall && hasPendingAnswerText && status !== "error" && status !== "incomplete"
            && !diagnostics.some(diagnostic => diagnostic.type === "assistant_source_changed")) {
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

        const summary: PaAgentTurnSummary = {
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
            ...(nativeWritingAttempted ? { nativeWritingAttempted: true as const } : {}),
            ...(nativeWriting ? { nativeWriting } : {}),
            ...(agentReportedIncomplete ? { agentReportedIncomplete: true as const } : {}),
        };
        turnAbort.dispose();
        return summary;
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
                ...(result.executionState ? { executionState: result.executionState } : {}),
                ...(result.recovery ? { recovery: result.recovery } : {}),
                originalLength,
                observationChars: promptText.length,
            },
        };
    }

    private createUserMessage(): PaAgentMessage {
        return {
            role: "user",
            id: this.options.userMessageId ?? this.createId("message_user"),
            content: this.options.userMessageContent ?? this.options.userInput,
            ...(this.options.userImages?.length ? { images: this.options.userImages.map((image) => ({ ...image, ref: { ...image.ref } })) } : {}),
            timestamp: this.now(),
        };
    }

    private async decideAfterTurn(summary: PaAgentTurnSummary): Promise<PaAgentAfterTurnDecision> {
        if (this.options.hostPolicy) {
            const decision = await this.evaluateHostPolicy(() => this.options.hostPolicy!.afterTurn(summary));
            this.debug('host_policy', { turnId: summary.turnId, action: decision.action, reason: decision.reason,
                ...('toolMode' in decision ? { nextToolMode: decision.toolMode ?? 'normal' } : {}),
                ...('status' in decision ? { status: decision.status } : {}) });
            return decision;
        }
        return {
            action: "stop",
            status: this.agentStatusFromTurn(summary.status),
            reason: summary.status,
            ...(summary.diagnostics.length > 0 ? { diagnostics: summary.diagnostics } : {}),
        };
    }

    private isNativeWritingCurrent(): boolean {
        try { return this.options.nativeWriting?.isCurrent() === true; }
        catch { return false; }
    }

    private isFinalTextCurrent(): boolean {
        try { return this.options.isFinalTextCurrent?.() ?? true; }
        catch { return false; }
    }

    private debug(phase: string, fields: Record<string, unknown>): void {
        try { this.options.onDebug?.(phase, fields); } catch { /* Observers cannot change loop decisions. */ }
    }

    private async decideFinalizationAfterTurn(
        summary: PaAgentTurnSummary,
        fallback: PaAgentTerminalDecision,
        unobservedTurnSummary?: PaAgentTurnSummary,
        useOrdinaryPolicyFallback = false,
    ): Promise<PaAgentTerminalDecision> {
        const hostPolicy = this.options.hostPolicy;
        if (!hostPolicy || (!hostPolicy.finalizeAfterTurn && !useOrdinaryPolicyFallback)) return fallback;

        const decision = await this.evaluateHostPolicy(() => hostPolicy.finalizeAfterTurn ? hostPolicy.finalizeAfterTurn(summary, {
            reason: fallback.reason,
            defaultStatus: fallback.status,
            ...(unobservedTurnSummary ? { unobservedTurnSummary } : {}),
        }) : hostPolicy.afterTurn(summary));
        this.debug('terminal_host_policy', { turnId: summary.turnId, action: decision.action, reason: decision.reason,
            ...('status' in decision ? { status: decision.status } : {}) });
        if (decision.action === "continue") {
            return mergeTerminalDecisions(fallback, {
                action: "stop",
                status: "incomplete",
                reason: "finalization_policy_requested_continuation",
                diagnostics: [{
                    type: "finalization_policy_requested_continuation",
                    message: "The terminal Host Policy requested another turn after the finalization boundary.",
                }],
            });
        }
        return mergeTerminalDecisions(fallback, {
            ...decision,
            status: decision.status ?? fallback.status,
        });
    }

    private async evaluateHostPolicy(
        evaluate: () => PaAgentAfterTurnDecision | Promise<PaAgentAfterTurnDecision>,
    ): Promise<PaAgentAfterTurnDecision> {
        const interrupt = this.createPolicyInterruptPromise();
        const decisionPromise: Promise<PolicyDecisionRaceResult> = Promise.resolve().then(evaluate).then(
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

    private endAgent(status: AgentEndStatus, payload: Record<string, unknown>): void {
        // Host policy may await after turn_end. Revalidate ordinary text at the
        // actual delivery boundary as well; a completed model turn is not delivery.
        if (this.committedFinalText.trim() && !this.turns.at(-1)?.nativeWritingAttempted
            && !this.isFinalTextCurrent()) {
            this.committedFinalText = "";
            this.options.onCommittedFinalText?.("");
            const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
            payload = { ...payload, diagnostics: [...diagnostics, { type: "assistant_source_changed" }] };
            if (status !== "aborted" && status !== "error") {
                status = "incomplete";
                payload.reason = "assistant_source_changed";
            }
        }
        this.endStatus = status;
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
                physicalAttemptCount: this.dispatcher.physicalAttemptCount,
                reusedToolResultCount: this.dispatcher.reuseCount,
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
            case "needs_user":
                return "needs_user";
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
            status: this.endStatus ?? status,
            transcript: [...this.transcript],
            committedFinalText: this.committedFinalText,
            turns: [...this.turns],
            ...(this.endPayload ? { endPayload: this.endPayload } : {}),
        };
    }

    private isAborted(): boolean {
        return this.options.signal?.aborted === true;
    }

    private isRemoteAttemptExceeded(startedAt: number | undefined): boolean {
        return startedAt !== undefined && Number.isFinite(this.remoteAttemptTimeoutMs)
            && this.remoteAttemptTimeoutMs >= 0
            && this.now() - startedAt >= this.remoteAttemptTimeoutMs;
    }

    private remoteAttemptRemainingMs(startedAt: number | undefined): number | undefined {
        if (startedAt === undefined || !Number.isFinite(this.remoteAttemptTimeoutMs)
            || this.remoteAttemptTimeoutMs < 0) return undefined;
        return Math.max(0, this.remoteAttemptTimeoutMs - (this.now() - startedAt));
    }

    private isRecoverableProviderTurn(summary: PaAgentTurnSummary): boolean {
        return summary.diagnostics.some((diagnostic) => diagnostic.type === "provider_error")
            && summary.diagnostics.some((diagnostic) => diagnostic.retryable === true)
            && !summary.diagnostics.some((diagnostic) => diagnostic.type === "provider_admission_rejected"
                || diagnostic.type === "context_local_overflow");
    }

    private providerRecoveryInstruction(summary: PaAgentTurnSummary): string | undefined {
        const signature = summary.diagnostics.some((diagnostic) => diagnostic.type === "provider_attempt_timeout")
            ? "provider_attempt_timeout" : "provider_error";
        const count = (this.providerNoProgressCounts.get(signature) ?? 0) + 1;
        this.providerNoProgressCounts.set(signature, count);
        if (count >= 4) return undefined;
        if (count >= 3) {
            return "The same provider attempt has failed three times without new evidence. Change strategy within the configured provider and current authorization: reduce only unnecessary request work, use an already available observation, or wait when a real Retry-After applies. Do not switch provider/model automatically or claim progress from retrying.";
        }
        return "The previous provider attempt ended before a complete response. Retry the task from the preserved run context. Do not repeat completed side effects; verify any operation whose acceptance is unknown before continuing.";
    }

    /** Retry-After waiting happens between turns, after the coordinator lease is released. */
    private async waitForProviderRetry(summary: PaAgentTurnSummary): Promise<void> {
        const retryAfterMs = summary.diagnostics.flatMap((diagnostic) => (
            typeof diagnostic.retryAfterMs === "number" && Number.isFinite(diagnostic.retryAfterMs)
                ? [Math.max(0, diagnostic.retryAfterMs)]
                : []
        )).at(-1);
        if (!retryAfterMs || this.isAborted()) return;
        this.debug("provider_retry_wait:start", { retryAfterMs });
        await new Promise<void>((resolve) => {
            let settled = false;
            let timerStarted = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timerStarted) clearPlatformTimeout(timer);
                this.options.signal?.removeEventListener("abort", finish);
                resolve();
            };
            this.options.signal?.addEventListener("abort", finish, { once: true });
            const timer: PlatformTimeoutHandle = setPlatformTimeout(finish, retryAfterMs);
            timerStarted = true;
        });
        this.debug("provider_retry_wait:end", { retryAfterMs, aborted: this.isAborted() });
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

    private isFinalizationReserveReached(toolMode: PaAgentToolMode | undefined): boolean {
        return this.usesFinalizationReserve(toolMode)
            && (this.turnDeadlineRemainingMs(toolMode) ?? Number.POSITIVE_INFINITY) <= 0;
    }

    private isTurnDeadlineExceeded(toolMode: PaAgentToolMode | undefined): boolean {
        return this.isWallClockExceeded() || this.isFinalizationReserveReached(toolMode);
    }

    private isProviderWaitDeadlineExceeded(
        toolMode: PaAgentToolMode | undefined,
        providerRequestStarted: boolean,
    ): boolean {
        return this.usesBufferedProviderHardDeadline(toolMode, providerRequestStarted)
            ? this.isWallClockExceeded()
            : this.isTurnDeadlineExceeded(toolMode);
    }

    private providerWaitDeadlineRemainingMs(
        toolMode: PaAgentToolMode | undefined,
        providerRequestStarted: boolean,
    ): number | undefined {
        return this.usesBufferedProviderHardDeadline(toolMode, providerRequestStarted)
            ? this.wallClockRemainingMs()
            : this.turnDeadlineRemainingMs(toolMode);
    }

    private usesBufferedProviderHardDeadline(
        toolMode: PaAgentToolMode | undefined,
        providerRequestStarted: boolean,
    ): boolean {
        return providerRequestStarted
            && this.providerResponseDelivery === "buffered"
            && this.usesFinalizationReserve(toolMode);
    }

    private didBufferedProviderOverrunFinalizationReserve(
        toolMode: PaAgentToolMode | undefined,
        providerRequestStarted: boolean,
    ): boolean {
        return this.usesBufferedProviderHardDeadline(toolMode, providerRequestStarted)
            && !this.isWallClockExceeded()
            && this.isFinalizationReserveReached(toolMode);
    }

    private turnDeadlineRemainingMs(toolMode: PaAgentToolMode | undefined): number | undefined {
        const hardRemainingMs = this.wallClockRemainingMs();
        if (hardRemainingMs === undefined) return undefined;
        if (!this.usesFinalizationReserve(toolMode)) return hardRemainingMs;
        return Math.max(0, hardRemainingMs - this.finalizationReserveMs);
    }

    private usesFinalizationReserve(toolMode: PaAgentToolMode | undefined): boolean {
        return this.finalizationReserveMs > 0 && toolMode !== "final_answer_only";
    }

    private turnDeadlineDiagnostic(
        toolMode: PaAgentToolMode | undefined,
    ): Record<string, unknown> {
        if (!this.isWallClockExceeded() && this.isFinalizationReserveReached(toolMode)) {
            return {
                type: "finalization_reserve_reached",
                finalizationReserveMs: this.finalizationReserveMs,
                maxWallClockMs: this.maxWallClockMs,
            };
        }
        return { type: "wall_clock_exceeded", maxWallClockMs: this.maxWallClockMs };
    }

    private deadlineDiagnostic(
        reason: "finalization_reserve_reached" | "wall_clock_exceeded",
    ): Record<string, unknown> {
        return reason === "finalization_reserve_reached"
            ? {
                type: reason,
                finalizationReserveMs: this.finalizationReserveMs,
                maxWallClockMs: this.maxWallClockMs,
            }
            : { type: reason, maxWallClockMs: this.maxWallClockMs };
    }

    private async prepareModelInputForProvider(
        input: PaAgentModelInput,
        toolMode: PaAgentToolMode | undefined,
        onDeadline: (reason: "finalization_reserve_reached" | "wall_clock_exceeded") => void,
    ): Promise<PaAgentModelInput> {
        const prepare = this.options.prepareModelInput;
        if (!prepare) return input;

        const remaining = this.turnDeadlineRemainingMs(toolMode);
        const deadlineReason = this.usesFinalizationReserve(toolMode)
            ? "finalization_reserve_reached" as const
            : "wall_clock_exceeded" as const;
        if (remaining !== undefined && remaining <= 0) {
            onDeadline(deadlineReason);
            throw new ProviderPreparationDeadlineError(deadlineReason);
        }

        const controller = new AbortController();
        let timedOut = false;
        let timer: PlatformTimeoutHandle | undefined;
        let rejectDeadline: (error: ProviderPreparationDeadlineError) => void = () => undefined;
        const deadlinePromise = new Promise<never>((_resolve, reject) => {
            rejectDeadline = reject;
        });
        const onAbort = () => controller.abort();
        input.signal?.addEventListener("abort", onAbort, { once: true });
        if (input.signal?.aborted) controller.abort();
        if (remaining !== undefined) {
            timer = setPlatformTimeout(() => {
                timedOut = true;
                onDeadline(deadlineReason);
                rejectDeadline(new ProviderPreparationDeadlineError(deadlineReason));
                controller.abort();
            }, remaining);
        }

        try {
            const prepared = await Promise.race([
                Promise.resolve(prepare({ ...input, signal: controller.signal })),
                deadlinePromise,
            ]);
            if (timedOut) throw new ProviderPreparationDeadlineError(deadlineReason);
            return {
                ...prepared,
                signal: input.signal,
                ...(input.notifyProviderRequestStarted
                    ? { notifyProviderRequestStarted: input.notifyProviderRequestStarted }
                    : {}),
            };
        } catch (error) {
            if (timedOut) throw new ProviderPreparationDeadlineError(deadlineReason);
            throw error;
        } finally {
            if (timer !== undefined) clearPlatformTimeout(timer);
            input.signal?.removeEventListener("abort", onAbort);
            controller.abort();
        }
    }

    private createFinalizationReserveSummary(
        turnIndex: number,
        controlSnapshot: AgentControlSnapshot | undefined,
    ): PaAgentTurnSummary {
        const diagnostic = this.turnDeadlineDiagnostic(undefined);
        return {
            turnId: `${this.options.runId}:finalization-reserve`,
            turnIndex,
            status: "incomplete",
            assistantMessage: {
                role: "assistant",
                id: `${this.options.runId}:finalization-reserve`,
                content: [],
                timestamp: this.now(),
            },
            committedFinalText: this.committedFinalText,
            pendingTextReclassified: false,
            toolCalls: [],
            toolResults: [],
            diagnostics: [diagnostic],
            metrics: [],
            timing: {
                turnIndex,
                status: "incomplete",
                elapsedMs: 0,
                modelElapsedMs: 0,
                modelChunkCount: 0,
                toolCallCount: 0,
                toolResultCount: 0,
            },
            controlSnapshot,
        };
    }

    private createTurnAbortScope(): {
        signal: AbortSignal;
        abort(): void;
        dispose(): void;
    } {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        this.options.signal?.addEventListener("abort", onAbort, { once: true });
        if (this.options.signal?.aborted) controller.abort();
        return {
            signal: controller.signal,
            abort: () => controller.abort(),
            dispose: () => this.options.signal?.removeEventListener("abort", onAbort),
        };
    }

    private createTurnLeaseWaitScope(toolMode: PaAgentToolMode | undefined): {
        signal: AbortSignal;
        deadlineReason(): "finalization_reserve_reached" | "wall_clock_exceeded" | undefined;
        dispose(): void;
    } {
        const controller = new AbortController();
        let timedOut = false;
        let timer: PlatformTimeoutHandle | undefined;
        const onAbort = () => controller.abort();
        const remaining = this.turnDeadlineRemainingMs(toolMode);
        this.options.signal?.addEventListener("abort", onAbort, { once: true });
        if (this.options.signal?.aborted) {
            controller.abort();
        } else if (remaining !== undefined) {
            timer = setPlatformTimeout(() => {
                timedOut = true;
                controller.abort();
            }, remaining);
        }
        return {
            signal: controller.signal,
            deadlineReason: () => {
                if (this.isWallClockExceeded()) return "wall_clock_exceeded";
                if (
                    timedOut
                    || this.isFinalizationReserveReached(toolMode)
                ) {
                    return this.usesFinalizationReserve(toolMode)
                        ? "finalization_reserve_reached"
                        : "wall_clock_exceeded";
                }
                return undefined;
            },
            dispose: () => {
                if (timer !== undefined) clearPlatformTimeout(timer);
                this.options.signal?.removeEventListener("abort", onAbort);
            },
        };
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
    if (getProviderAdmissionError(error)) return { type: "provider_admission_rejected" };
    if (error instanceof PaAgentContextOverflowError) {
        return { type: "context_local_overflow", promptChars: error.promptChars, maxPromptChars: error.maxPromptChars };
    }
    const retryAfterMs = readRetryAfterMs(error);
    return {
        type: "provider_error",
        message: errorMessage(error),
        retryable: isRetryableProviderTransportError(error),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
}

function readRetryAfterMs(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;
    const record = error as Record<string, unknown>;
    const direct = numberValue(record.retryAfterMs);
    if (direct !== undefined && direct >= 0) return direct;
    const headers = record.headers;
    let raw: unknown;
    if (headers && typeof headers === "object") {
        const getter = (headers as { get?: (name: string) => unknown }).get;
        if (typeof getter === "function") {
            try { raw = getter.call(headers, "retry-after"); } catch { /* malformed provider headers */ }
        }
        raw ??= (headers as Record<string, unknown>)["retry-after"]
            ?? (headers as Record<string, unknown>)["Retry-After"];
    }
    if (typeof raw !== "string" && typeof raw !== "number") return undefined;
    const text = String(raw).trim();
    if (!text) return undefined;
    const seconds = Number(text);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function isRetryableProviderTransportError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const record = error as Record<string, unknown>;
    const status = numberValue(record.status) ?? numberValue(record.statusCode);
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
    const code = stringValue(record.code)
        ?? stringValue((record.cause as Record<string, unknown> | undefined)?.code);
    return code !== undefined && new Set([
        "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
    ]).has(code.toUpperCase());
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isOrdinaryEmptyFinalizationResponse(summary: PaAgentTurnSummary): boolean {
    return summary.status === "incomplete"
        && summary.toolCalls.length === 0
        && summary.diagnostics.some((diagnostic) => diagnostic.type === "assistant_empty_response")
        && !summary.diagnostics.some((diagnostic) => (
            diagnostic.type === "finalization_reserve_reached"
            || diagnostic.type === "wall_clock_exceeded"
            || diagnostic.type === "finalization_reserve_exhausted_by_buffered_provider"
            || diagnostic.type === "finalization_reserve_overrun"
        ));
}

function isEmptyBufferedFinalizationOverrun(summary: PaAgentTurnSummary): boolean {
    return summary.status === "incomplete"
        && summary.toolCalls.length === 0
        && summary.diagnostics.some((diagnostic) => diagnostic.type === "finalization_reserve_overrun")
        && !summary.diagnostics.some((diagnostic) => (
            diagnostic.type === "user_abort"
            || diagnostic.type === "wall_clock_exceeded"
            || diagnostic.type === "provider_error"
            || diagnostic.type === "model_input_preparation_error"
        ));
}

function mergeTerminalDecisions(
    fallback: PaAgentTerminalDecision,
    decision: PaAgentTerminalDecision,
): PaAgentTerminalDecision {
    const warnings = [
        ...(fallback.warnings ?? []),
        ...(decision.warnings ?? []),
    ];
    const diagnostics = [
        ...(fallback.diagnostics ?? []),
        ...(decision.diagnostics ?? []),
    ];
    return {
        action: "stop",
        status: moreConservativeTerminalStatus(fallback.status, decision.status),
        reason: decision.reason,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
}

function moreConservativeTerminalStatus(
    fallback: AgentEndStatus,
    decision: AgentEndStatus,
): AgentEndStatus {
    const priority: Record<AgentEndStatus, number> = {
        completed: 0,
        completed_with_warning: 1,
        needs_user: 2,
        incomplete: 3,
        error: 4,
        aborted: 5,
    };
    return priority[decision] > priority[fallback] ? decision : fallback;
}

function isPreflightOnlyToolResult(result: PaAgentToolExecutionResult): boolean {
    if (result.metadata?.preflightOnly === true) return true;
    return result.outcome === "schema_invalid"
        || result.outcome === "budget_exceeded"
        || result.outcome === "duplicate_skipped"
        || result.outcome === "control_applied";
}

function elapsedSince(startedAt: number, endedAt: number): number {
    return Math.max(0, endedAt - startedAt);
}

function normalizeFinalizationReserveMs(
    reserveMs: number | undefined,
    maxWallClockMs: number,
): number {
    if (
        reserveMs === undefined
        || !Number.isFinite(reserveMs)
        || reserveMs <= 0
        || !Number.isFinite(maxWallClockMs)
        || maxWallClockMs < 0
    ) {
        return 0;
    }
    return Math.min(reserveMs, maxWallClockMs);
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

function canonicalizeBufferedToolCallParts(
    buffers: BufferedToolCall[],
    parts: AssistantMessagePart[],
): void {
    if (buffers.length < 2) return;
    const entries = buffers.map((buffer) => ({
        buffer,
        originalPartIndex: buffer.partIndex,
        part: parts[buffer.partIndex],
    }));
    if (entries.some((entry) => !isToolCallPart(entry.part))) return;
    const partIndexes = entries
        .map((entry) => entry.originalPartIndex)
        .sort((left, right) => left - right);
    entries.sort((left, right) => (
        left.buffer.index - right.buffer.index
        || left.originalPartIndex - right.originalPartIndex
    ));
    for (let index = 0; index < entries.length; index++) {
        const partIndex = partIndexes[index];
        parts[partIndex] = entries[index].part!;
        entries[index].buffer.partIndex = partIndex;
    }
    buffers.splice(0, buffers.length, ...entries.map((entry) => entry.buffer));
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
    return outcome !== "success" && outcome !== "reused_result"
        && outcome !== "duplicate_skipped" && outcome !== "control_applied";
}

function stringifyToolInput(input: unknown): string {
    if (typeof input === "string") return input;
    if (input === undefined) return "";
    return JSON.stringify(input);
}

function minimumDefined(left: number | undefined, right: number | undefined): number | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.min(left, right);
}

function createIncrementingIdFactory(): (prefix: string) => string {
    let nextId = 1;
    return (prefix: string) => `${prefix}_${nextId++}`;
}
