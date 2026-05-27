import { describe, expect, it, jest } from "@jest/globals";

import {
    AgentEventEmitter,
    AgentLifecycleEventEmitter,
    RUN_SCOPE_TURN_ID,
    TURN_DEADLINE_ERROR_NAME,
    TurnExecutionDeadline,
    createAgentAuditScopeKey,
    createAgentEventKey,
} from "../src/ai-services/agent-runtime-primitives";
import type { AgentEvent, LegacyAgentEvent } from "../src/ai-services/chat-types";

describe("AgentEventEmitter", () => {
    it("emits versioned events with stable turn id and incrementing sequence", () => {
        const events: LegacyAgentEvent[] = [];
        const emitter = new AgentEventEmitter((event) => events.push(event));

        emitter.activity("loop-start", "Starting assistant loop");
        emitter.activity("answering", "Producing final answer");

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            version: 1,
            kind: "activity",
            seq: 1,
            type: "loop-start",
        });
        expect(events[1]).toMatchObject({
            version: 1,
            kind: "activity",
            seq: 2,
            type: "answering",
        });
        expect(events[1].turnId).toBe(events[0].turnId);
    });
});

describe("AgentLifecycleEventEmitter", () => {
    it("emits canonical events with mandatory run and turn identity", () => {
        const events: AgentEvent[] = [];
        const timestamps = [100, 101, 102, 103, 104, 105];
        const emitter = new AgentLifecycleEventEmitter({
            runId: "run_1",
            now: () => timestamps.shift() ?? 999,
            onEvent: (event) => events.push(event),
        });
        const userMessage = {
            role: "user" as const,
            id: "message_user_1",
            content: "hello",
            timestamp: 100,
        };

        emitter.agentStart();
        emitter.turnStart("turn_1");
        emitter.messageStart("turn_1", userMessage);
        emitter.messageEnd("turn_1", userMessage);
        emitter.turnEnd("turn_1", "completed");
        emitter.agentEnd("completed");

        expect(events.map((event) => event.type)).toEqual([
            "agent_start",
            "turn_start",
            "message_start",
            "message_end",
            "turn_end",
            "agent_end",
        ]);
        expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(events.map((event) => event.timestamp)).toEqual([100, 101, 102, 103, 104, 105]);
        expect(new Set(events.map((event) => event.runId))).toEqual(new Set(["run_1"]));
        for (const event of events) {
            expect(event.version).toBe(2);
            expect(event.runId).toBe("run_1");
            expect(event.turnId.length).toBeGreaterThan(0);
            expect(createAgentEventKey(event)).toBe(`${encodeURIComponent(event.runId)}:${encodeURIComponent(event.turnId)}:${event.seq}`);
            if (event.scope === "run") {
                expect(event.turnId).toBe(RUN_SCOPE_TURN_ID);
            } else {
                expect(event.turnId).toBe("turn_1");
            }
        }
        expect(events[0]).toMatchObject({
            version: 2,
            scope: "run",
            turnId: RUN_SCOPE_TURN_ID,
            type: "agent_start",
        });
        expect(events[1]).toMatchObject({
            scope: "turn",
            turnId: "turn_1",
            type: "turn_start",
        });
        expect(events.at(-1)).toMatchObject({
            scope: "run",
            turnId: RUN_SCOPE_TURN_ID,
            type: "agent_end",
            status: "completed",
            metadata: { finalTurnId: "turn_1" },
        });
        expect(createAgentAuditScopeKey(events[1])).toBe("run_1:turn_1");
        expect(createAgentEventKey(events[1])).toBe("run_1:turn_1:2");
        expect(events.at(-1)?.type).toBe("agent_end");
    });

    it("supports assistant parts, tool execution, toolResult messages, and lifecycle statuses", () => {
        const events: AgentEvent[] = [];
        const emitter = new AgentLifecycleEventEmitter({
            runId: "run_2",
            now: () => 200,
            onEvent: (event) => events.push(event),
        });
        const assistantMessage = {
            role: "assistant" as const,
            id: "message_assistant_1",
            content: [
                { type: "thinking" as const, text: "Need context." },
                { type: "text" as const, text: "I will check that." },
                { type: "toolCall" as const, id: "call_1", name: "search_memory", input: { query: "launch" }, index: 0 },
            ],
            stopReason: "tool_calls" as const,
            timestamp: 200,
        };
        const toolResultMessage = {
            role: "toolResult" as const,
            id: "message_tool_1",
            toolCallId: "call_1",
            toolName: "search_memory",
            isError: false,
            timestamp: 200,
            content: {
                promptText: "Launch note result.",
                previewText: "Launch note result.",
                includeInNextPrompt: true,
                sourceRecords: [{
                    kind: "memory-reference" as const,
                    dedupKey: "memory:launch.md",
                    sourceBoundary: "memory" as const,
                    path: "launch.md",
                }],
                contextUsed: [{
                    category: "memory" as const,
                    label: "launch.md",
                    citationEligible: true,
                }],
                metadata: { outcome: "success" },
            },
        };

        emitter.agentStart();
        emitter.turnStart("turn_2");
        emitter.messageStart("turn_2", assistantMessage);
        emitter.messageUpdate("turn_2", "message_assistant_1", { kind: "text_delta", text: "I will check that." });
        emitter.toolExecutionStart("turn_2", "call_1", "search_memory", { query: "launch" });
        emitter.toolExecutionUpdate("turn_2", "call_1", "search_memory", { phase: "running" });
        emitter.toolExecutionEnd("turn_2", "call_1", "search_memory", "success");
        emitter.messageStart("turn_2", toolResultMessage);
        emitter.messageEnd("turn_2", toolResultMessage);
        emitter.turnEnd("turn_2", "tool_results_ready");
        emitter.agentEnd("completed_with_warning", { warningCount: 1 });

        expect(events.map((event) => event.type)).toEqual([
            "agent_start",
            "turn_start",
            "message_start",
            "message_update",
            "tool_execution_start",
            "tool_execution_update",
            "tool_execution_end",
            "message_start",
            "message_end",
            "turn_end",
            "agent_end",
        ]);
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "tool_execution_end", outcome: "success" }),
            expect.objectContaining({ type: "turn_end", status: "tool_results_ready" }),
            expect.objectContaining({ type: "agent_end", status: "completed_with_warning" }),
        ]));
        const toolResultEnd = events.find((event) => event.type === "message_end" && event.message.role === "toolResult");
        expect(toolResultEnd).toMatchObject({
            type: "message_end",
            message: {
                role: "toolResult",
                content: {
                    promptText: "Launch note result.",
                    previewText: "Launch note result.",
                    includeInNextPrompt: true,
                    sourceRecords: [expect.objectContaining({
                        kind: "memory-reference",
                        sourceBoundary: "memory",
                    })],
                    contextUsed: [expect.objectContaining({
                        category: "memory",
                        citationEligible: true,
                    })],
                    metadata: { outcome: "success" },
                },
            },
        });
    });

    it("accepts every canonical turn and agent terminal status", () => {
        const turnStatuses = [
            "completed",
            "tool_results_ready",
            "completed_with_warning",
            "incomplete",
            "aborted",
            "error",
        ] as const;
        const agentStatuses = [
            "completed",
            "completed_with_warning",
            "incomplete",
            "aborted",
            "error",
        ] as const;

        for (const status of turnStatuses) {
            const events: AgentEvent[] = [];
            const emitter = new AgentLifecycleEventEmitter({
                runId: `run_turn_${status}`,
                onEvent: (event) => events.push(event),
            });

            emitter.turnStart("turn_1");
            emitter.turnEnd("turn_1", status);

            expect(events.at(-1)).toMatchObject({
                type: "turn_end",
                status,
            });
        }

        for (const status of agentStatuses) {
            const events: AgentEvent[] = [];
            const emitter = new AgentLifecycleEventEmitter({
                runId: `run_agent_${status}`,
                onEvent: (event) => events.push(event),
            });

            emitter.agentEnd(status);

            expect(events.at(-1)).toMatchObject({
                type: "agent_end",
                status,
                turnId: RUN_SCOPE_TURN_ID,
            });
        }
    });

    it("rejects missing ids and reserved run-scope turn id on turn events", () => {
        expect(() => new AgentLifecycleEventEmitter({ runId: "" })).toThrow("runId must be a non-empty string");

        const emitter = new AgentLifecycleEventEmitter({ runId: "run_1" });

        expect(() => emitter.turnStart("")).toThrow("turnId must be a non-empty string");
        expect(() => emitter.turnStart(RUN_SCOPE_TURN_ID)).toThrow("turnId must be an actual turn id");
        expect(() => emitter.messageUpdate("turn_1", "", { kind: "text_delta", text: "hello" }))
            .toThrow("messageId must be a non-empty string");
        expect(() => emitter.toolExecutionStart("turn_1", "call_1", ""))
            .toThrow("toolName must be a non-empty string");
    });

    it("treats agent_end as the terminal canonical event", () => {
        const emitter = new AgentLifecycleEventEmitter({ runId: "run_1" });

        emitter.agentStart();
        emitter.agentEnd("completed");

        expect(() => emitter.turnStart("turn_1"))
            .toThrow("agent_end is terminal; no further lifecycle events can be emitted");
        expect(() => emitter.agentEnd("completed"))
            .toThrow("agent_end is terminal; no further lifecycle events can be emitted");
    });

    it("encodes audit keys so id delimiters cannot collide", () => {
        const emitter = new AgentLifecycleEventEmitter({ runId: "run:1" });

        const turn = emitter.turnStart("turn:1");

        expect(createAgentAuditScopeKey(turn)).toBe("run%3A1:turn%3A1");
        expect(createAgentEventKey(turn)).toBe("run%3A1:turn%3A1:1");
    });
});

describe("TurnExecutionDeadline", () => {
    it("rejects in-flight work with the configured deadline error", async () => {
        jest.useFakeTimers();
        const deadline = new TurnExecutionDeadline(undefined, 10, "turn timed out");

        const pending = deadline.race(new Promise(() => undefined));
        jest.advanceTimersByTime(10);

        await expect(pending).rejects.toMatchObject({
            name: TURN_DEADLINE_ERROR_NAME,
            message: "turn timed out",
        });
        deadline.dispose();
        jest.useRealTimers();
    });
});
