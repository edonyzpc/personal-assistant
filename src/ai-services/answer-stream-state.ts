import type {
    AgentSegmentBoundary,
    AgentSegmentBoundaryReason,
    AgentSegmentState,
} from "./chat-types";

export type {
    AgentSegmentBoundary,
    AgentSegmentBoundaryReason,
    AgentSegmentState,
} from "./chat-types";

export type NoReplayFallbackStage = "before-visible-output" | "mid-tool" | "post-visible-output";
export type NoReplayFallbackAction = "retry-non-streaming" | "retry-current-tool" | "graceful-close";

export interface NoReplayFallbackDecision {
    stage: NoReplayFallbackStage;
    action: NoReplayFallbackAction;
}

export const DEFAULT_ANSWER_STREAM_MAX_TOOL_CALLS = 6;
export const DEFAULT_ANSWER_STREAM_MAX_OBSERVATION_CHARS = 12000;

export type AnswerStreamBudgetFailureReason = "tool-call-limit" | "observation-limit";

export type AnswerStreamBudgetCheck =
    | {
        ok: true;
        remainingToolCalls: number;
        remainingObservationChars: number;
    }
    | {
        ok: false;
        reason: AnswerStreamBudgetFailureReason;
        message: string;
    };

export interface AnswerStreamTurnBudgetOptions {
    maxToolCalls?: number;
    maxObservationChars?: number;
}

export class AgentSegmentStateMachine {
    private stateValue: AgentSegmentState = "thinking";
    private readonly boundariesValue: AgentSegmentBoundary[] = [];
    private openAnswerSegment = false;

    get state(): AgentSegmentState {
        return this.stateValue;
    }

    get boundaries(): AgentSegmentBoundary[] {
        return this.boundariesValue.map((boundary) => ({ ...boundary }));
    }

    onAnswerDelta(): AgentSegmentBoundary | null {
        if (this.stateValue === "thinking") {
            this.openAnswerSegment = true;
            return this.transition("answering", "answer-started");
        }
        if (this.stateValue === "tool-calling") {
            this.openAnswerSegment = true;
            return this.transition("answering", "answer-resumed");
        }
        this.openAnswerSegment = true;
        return null;
    }

    onToolCallDelta(): AgentSegmentBoundary | null {
        if (this.stateValue === "thinking") {
            return this.transition("tool-calling", "tool-call-started");
        }
        if (this.stateValue === "answering") {
            if (this.openAnswerSegment) {
                throw new Error("Tool call delta cannot arrive before the current answer segment is closed.");
            }
            return this.transition("tool-calling", "tool-call-started");
        }
        return null;
    }

    closeAnswerSegment(): void {
        this.openAnswerSegment = false;
    }

    finishToolCall(): AgentSegmentBoundary | null {
        if (this.stateValue !== "tool-calling") return null;
        return this.transition("answering", "tool-call-finished");
    }

    private transition(to: AgentSegmentState, reason: AgentSegmentBoundaryReason): AgentSegmentBoundary {
        const boundary: AgentSegmentBoundary = {
            from: this.stateValue,
            to,
            reason,
        };
        this.stateValue = to;
        this.boundariesValue.push(boundary);
        return boundary;
    }
}

export class AnswerStreamTurnBudget {
    private toolCalls = 0;
    private observationChars = 0;
    private readonly maxToolCalls: number;
    private readonly maxObservationChars: number;

    constructor(options: AnswerStreamTurnBudgetOptions = {}) {
        this.maxToolCalls = normalizePositiveLimit(
            options.maxToolCalls,
            DEFAULT_ANSWER_STREAM_MAX_TOOL_CALLS,
        );
        this.maxObservationChars = normalizePositiveLimit(
            options.maxObservationChars,
            DEFAULT_ANSWER_STREAM_MAX_OBSERVATION_CHARS,
        );
    }

    recordToolCall(): AnswerStreamBudgetCheck {
        if (this.toolCalls >= this.maxToolCalls) {
            return {
                ok: false,
                reason: "tool-call-limit",
                message: "Tool call limit reached; answering from gathered context.",
            };
        }
        this.toolCalls++;
        return this.remaining();
    }

    recordObservation(observation: unknown): AnswerStreamBudgetCheck {
        const chars = getObservationCharLength(observation);
        if (this.observationChars + chars > this.maxObservationChars) {
            return {
                ok: false,
                reason: "observation-limit",
                message: "Observation budget reached; answering from gathered context.",
            };
        }
        this.observationChars += chars;
        return this.remaining();
    }

    snapshot(): { toolCalls: number; observationChars: number } {
        return {
            toolCalls: this.toolCalls,
            observationChars: this.observationChars,
        };
    }

    private remaining(): AnswerStreamBudgetCheck {
        return {
            ok: true,
            remainingToolCalls: Math.max(0, this.maxToolCalls - this.toolCalls),
            remainingObservationChars: Math.max(0, this.maxObservationChars - this.observationChars),
        };
    }
}

export function classifyNoReplayFallback(input: {
    visibleOutputStarted: boolean;
    toolExecutionInFlight: boolean;
}): NoReplayFallbackDecision {
    if (!input.visibleOutputStarted) {
        return { stage: "before-visible-output", action: "retry-non-streaming" };
    }
    if (input.toolExecutionInFlight) {
        return { stage: "mid-tool", action: "retry-current-tool" };
    }
    return { stage: "post-visible-output", action: "graceful-close" };
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value !== undefined && value > 0
        ? Math.floor(value)
        : fallback;
}

function getObservationCharLength(observation: unknown): number {
    if (typeof observation === "string") return observation.length;
    try {
        return JSON.stringify(observation)?.length ?? 0;
    } catch {
        return String(observation).length;
    }
}
