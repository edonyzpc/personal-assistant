import { describe, expect, it } from "@jest/globals";

import {
    AgentSegmentStateMachine,
    AnswerStreamTurnBudget,
    classifyNoReplayFallback,
} from "../src/ai-services/answer-stream-state";

describe("AgentSegmentStateMachine", () => {
    it("allows thinking to answering", () => {
        const machine = new AgentSegmentStateMachine();

        expect(machine.onAnswerDelta()).toEqual({
            from: "thinking",
            to: "answering",
            reason: "answer-started",
        });
        expect(machine.state).toBe("answering");
    });

    it("allows thinking to tool-calling to answering", () => {
        const machine = new AgentSegmentStateMachine();

        expect(machine.onToolCallDelta()).toEqual({
            from: "thinking",
            to: "tool-calling",
            reason: "tool-call-started",
        });
        expect(machine.finishToolCall()).toEqual({
            from: "tool-calling",
            to: "answering",
            reason: "tool-call-finished",
        });
        expect(machine.onAnswerDelta()).toBeNull();
        expect(machine.boundaries.map((boundary) => boundary.reason)).toEqual([
            "tool-call-started",
            "tool-call-finished",
        ]);
    });

    it("allows answering to tool-calling only after closing the answer segment", () => {
        const machine = new AgentSegmentStateMachine();

        machine.onAnswerDelta();
        expect(() => machine.onToolCallDelta()).toThrow(/answer segment is closed/);

        machine.closeAnswerSegment();
        expect(machine.onToolCallDelta()).toEqual({
            from: "answering",
            to: "tool-calling",
            reason: "tool-call-started",
        });
    });
});

describe("no-replay fallback classifier", () => {
    it("classifies fallback stages and actions", () => {
        expect(classifyNoReplayFallback({
            visibleOutputStarted: false,
            toolExecutionInFlight: false,
        })).toEqual({ stage: "before-visible-output", action: "retry-non-streaming" });
        expect(classifyNoReplayFallback({
            visibleOutputStarted: true,
            toolExecutionInFlight: true,
        })).toEqual({ stage: "mid-tool", action: "retry-current-tool" });
        expect(classifyNoReplayFallback({
            visibleOutputStarted: true,
            toolExecutionInFlight: false,
        })).toEqual({ stage: "post-visible-output", action: "graceful-close" });
    });
});

describe("AnswerStreamTurnBudget", () => {
    it("tracks tool call and observation budgets independently", () => {
        const budget = new AnswerStreamTurnBudget({
            maxToolCalls: 2,
            maxObservationChars: 10,
        });

        expect(budget.recordToolCall()).toEqual({
            ok: true,
            remainingToolCalls: 1,
            remainingObservationChars: 10,
        });
        expect(budget.recordObservation("12345")).toEqual({
            ok: true,
            remainingToolCalls: 1,
            remainingObservationChars: 5,
        });
        expect(budget.recordToolCall()).toEqual({
            ok: true,
            remainingToolCalls: 0,
            remainingObservationChars: 5,
        });
        expect(budget.recordToolCall()).toEqual({
            ok: false,
            reason: "tool-call-limit",
            message: "Tool call limit reached; answering from gathered context.",
        });
        expect(budget.recordObservation("123456")).toEqual({
            ok: false,
            reason: "observation-limit",
            message: "Observation budget reached; answering from gathered context.",
        });
        expect(budget.snapshot()).toEqual({
            toolCalls: 2,
            observationChars: 5,
        });
    });

    it("uses serialized length for structured observations", () => {
        const budget = new AnswerStreamTurnBudget({
            maxObservationChars: 20,
        });

        expect(budget.recordObservation({ ok: true })).toEqual(expect.objectContaining({
            ok: true,
            remainingObservationChars: 9,
        }));
    });
});
