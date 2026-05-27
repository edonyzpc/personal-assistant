import { createAbortError, isAbortError, throwIfAborted } from "./chat-utils";
import type {
    AgentActivityType,
    AgentEvent,
    AgentEndStatus,
    AgentMessageUpdate,
    LegacyAgentEvent,
    PaAgentMessage,
    ChatTurnMemoryMetadata,
    ToolExecutionOutcome,
    TurnEndStatus,
} from "./chat-types";
import { RUN_SCOPE_TURN_ID } from "./chat-types";

export const TURN_DEADLINE_ERROR_NAME = "TurnDeadlineExceededError";
export { RUN_SCOPE_TURN_ID };

export function createTurnDeadlineExceededError(reason: string): Error {
    const error = new Error(reason);
    error.name = TURN_DEADLINE_ERROR_NAME;
    return error;
}

export function isTurnDeadlineExceededError(error: unknown): boolean {
    return error instanceof Error && error.name === TURN_DEADLINE_ERROR_NAME;
}

export class TurnExecutionDeadline {
    private readonly controller = new AbortController();
    private readonly externalSignal?: AbortSignal;
    private readonly timeoutMs: number;
    private readonly timeoutReason: string;
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private deadlineExceeded = false;
    private readonly externalAbortHandler: () => void;

    constructor(externalSignal: AbortSignal | undefined, timeoutMs: number, timeoutReason: string) {
        this.externalSignal = externalSignal;
        this.timeoutMs = timeoutMs;
        this.timeoutReason = timeoutReason;
        this.externalAbortHandler = () => {
            this.controller.abort();
        };

        if (externalSignal?.aborted) {
            this.controller.abort();
        } else {
            externalSignal?.addEventListener("abort", this.externalAbortHandler, { once: true });
        }

        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            this.timeoutId = setTimeout(() => {
                this.deadlineExceeded = true;
                this.controller.abort();
            }, timeoutMs);
        }
    }

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    dispose(): void {
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.externalSignal?.removeEventListener("abort", this.externalAbortHandler);
    }

    throwIfAborted(): void {
        if (this.deadlineExceeded) {
            throw createTurnDeadlineExceededError(this.timeoutReason);
        }
        throwIfAborted(this.signal);
    }

    isDeadlineError(error: unknown): boolean {
        return isTurnDeadlineExceededError(error)
            || (this.deadlineExceeded && isAbortError(error, this.signal));
    }

    async race<T>(promise: PromiseLike<T>): Promise<T> {
        if (this.deadlineExceeded) {
            throw createTurnDeadlineExceededError(this.timeoutReason);
        }
        if (this.signal.aborted) {
            throw createAbortError();
        }

        return new Promise<T>((resolve, reject) => {
            const cleanup = () => this.signal.removeEventListener("abort", onAbort);
            const onAbort = () => {
                cleanup();
                reject(this.deadlineExceeded
                    ? createTurnDeadlineExceededError(this.timeoutReason)
                    : createAbortError());
            };
            this.signal.addEventListener("abort", onAbort, { once: true });
            Promise.resolve(promise).then(
                (value) => {
                    cleanup();
                    resolve(value);
                },
                (error) => {
                    cleanup();
                    reject(error);
                },
            );
        });
    }
}

export class AgentEventEmitter {
    private seq = 0;
    readonly turnId: string;

    constructor(private readonly onEvent?: (event: LegacyAgentEvent) => void) {
        this.turnId = createAgentTurnId();
    }

    activity(type: AgentActivityType, summary: string, detail?: Record<string, unknown>): void {
        this.emit({ ...this.baseEvent(), kind: "activity", type, summary, detail });
    }

    answerStarted(): void {
        this.emit({ ...this.baseEvent(), kind: "answer-started" });
    }

    answerSnapshot(snapshot: string): void {
        this.emit({ ...this.baseEvent(), kind: "answer-snapshot", snapshot });
    }

    reasoningChunk(chunk: string): void {
        this.emit({ ...this.baseEvent(), kind: "reasoning-chunk", chunk });
    }

    turnMetadata(metadata: ChatTurnMemoryMetadata): void {
        this.emit({ ...this.baseEvent(), kind: "turn-metadata", metadata });
    }

    answerComplete(): void {
        this.emit({ ...this.baseEvent(), kind: "answer-complete" });
    }

    partialOutputError(category: string): void {
        this.emit({ ...this.baseEvent(), kind: "partial-output-error", category });
    }

    aborted(): void {
        this.emit({ ...this.baseEvent(), kind: "aborted" });
    }

    private baseEvent() {
        return {
            version: 1 as const,
            turnId: this.turnId,
            seq: ++this.seq,
            timestamp: Date.now(),
        };
    }

    private emit(event: LegacyAgentEvent): void {
        this.onEvent?.(event);
    }
}

export interface AgentLifecycleEventEmitterOptions {
    runId: string;
    now?: () => number;
    onEvent?: (event: AgentEvent) => void;
}

export class AgentLifecycleEventEmitter {
    private seq = 0;
    private finalTurnId: string | undefined;
    private closed = false;
    private readonly runId: string;
    private readonly now: () => number;
    private readonly onEvent?: (event: AgentEvent) => void;

    constructor(options: AgentLifecycleEventEmitterOptions) {
        this.runId = requireNonEmptyId(options.runId, "runId");
        this.now = options.now ?? Date.now;
        this.onEvent = options.onEvent;
    }

    agentStart(metadata?: Record<string, unknown>): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.runBase("agent_start"),
            metadata,
        });
    }

    turnStart(turnId: string, metadata?: Record<string, unknown>): AgentEvent {
        this.assertOpen();
        const normalizedTurnId = this.requireTurnId(turnId);
        this.finalTurnId = normalizedTurnId;
        return this.emit({
            ...this.turnBase("turn_start", normalizedTurnId),
            metadata,
        });
    }

    messageStart(turnId: string, message: PaAgentMessage, metadata?: Record<string, unknown>): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("message_start", this.requireTurnId(turnId)),
            message,
            metadata,
        });
    }

    messageUpdate(
        turnId: string,
        messageId: string,
        update: AgentMessageUpdate,
        metadata?: Record<string, unknown>,
    ): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("message_update", this.requireTurnId(turnId)),
            messageId: requireNonEmptyId(messageId, "messageId"),
            update,
            metadata,
        });
    }

    messageEnd(turnId: string, message: PaAgentMessage, metadata?: Record<string, unknown>): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("message_end", this.requireTurnId(turnId)),
            message,
            metadata,
        });
    }

    toolExecutionStart(
        turnId: string,
        toolCallId: string,
        toolName: string,
        input?: unknown,
        metadata?: Record<string, unknown>,
    ): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("tool_execution_start", this.requireTurnId(turnId)),
            toolCallId: requireNonEmptyId(toolCallId, "toolCallId"),
            toolName: requireNonEmptyId(toolName, "toolName"),
            input,
            metadata,
        });
    }

    toolExecutionUpdate(
        turnId: string,
        toolCallId: string,
        toolName: string,
        metadata?: Record<string, unknown>,
    ): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("tool_execution_update", this.requireTurnId(turnId)),
            toolCallId: requireNonEmptyId(toolCallId, "toolCallId"),
            toolName: requireNonEmptyId(toolName, "toolName"),
            metadata,
        });
    }

    toolExecutionEnd(
        turnId: string,
        toolCallId: string,
        toolName: string,
        outcome: ToolExecutionOutcome,
        metadata?: Record<string, unknown>,
    ): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("tool_execution_end", this.requireTurnId(turnId)),
            toolCallId: requireNonEmptyId(toolCallId, "toolCallId"),
            toolName: requireNonEmptyId(toolName, "toolName"),
            outcome,
            metadata,
        });
    }

    turnEnd(
        turnId: string,
        status: TurnEndStatus,
        metadata?: Record<string, unknown>,
        toolResults?: Array<Extract<PaAgentMessage, { role: "toolResult" }>>,
    ): AgentEvent {
        this.assertOpen();
        return this.emit({
            ...this.turnBase("turn_end", this.requireTurnId(turnId)),
            status,
            toolResults,
            metadata,
        });
    }

    agentEnd(status: AgentEndStatus, metadata?: Record<string, unknown>): AgentEvent {
        this.assertOpen();
        this.closed = true;
        return this.emit({
            ...this.runBase("agent_end"),
            status,
            metadata: {
                ...metadata,
                ...(this.finalTurnId ? { finalTurnId: this.finalTurnId } : {}),
            },
        });
    }

    private assertOpen(): void {
        if (this.closed) {
            throw new Error("agent_end is terminal; no further lifecycle events can be emitted.");
        }
    }

    private runBase<T extends "agent_start" | "agent_end">(type: T) {
        return {
            version: 2 as const,
            runId: this.runId,
            turnId: RUN_SCOPE_TURN_ID as typeof RUN_SCOPE_TURN_ID,
            scope: "run" as const,
            seq: ++this.seq,
            timestamp: this.now(),
            type,
        };
    }

    private turnBase<T extends Exclude<AgentEvent["type"], "agent_start" | "agent_end">>(type: T, turnId: string) {
        return {
            version: 2 as const,
            runId: this.runId,
            turnId,
            scope: "turn" as const,
            seq: ++this.seq,
            timestamp: this.now(),
            type,
        };
    }

    private requireTurnId(turnId: string): string {
        const normalizedTurnId = requireNonEmptyId(turnId, "turnId");
        if (normalizedTurnId === RUN_SCOPE_TURN_ID) {
            throw new Error("turnId must be an actual turn id for turn-scoped events.");
        }
        return normalizedTurnId;
    }

    private emit(event: AgentEvent): AgentEvent {
        this.onEvent?.(event);
        return event;
    }
}

export function createAgentAuditScopeKey(event: Pick<AgentEvent, "runId" | "turnId">): string {
    return `${encodeURIComponent(event.runId)}:${encodeURIComponent(event.turnId)}`;
}

export function createAgentEventKey(event: Pick<AgentEvent, "runId" | "turnId" | "seq">): string {
    return `${encodeURIComponent(event.runId)}:${encodeURIComponent(event.turnId)}:${event.seq}`;
}

function createAgentTurnId(): string {
    return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function requireNonEmptyId(value: string, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value;
}
