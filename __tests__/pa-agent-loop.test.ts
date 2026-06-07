import { beforeEach, describe, expect, it } from "@jest/globals";

import { RUN_SCOPE_TURN_ID } from "../src/ai-services/agent-runtime-primitives";
import {
    createAgentControlSnapshot,
    createInitialAgentControlSnapshot,
} from "../src/ai-services/pa-agent-control-policy";
import {
    PaAgentLoop,
    type PaAgentModel,
    type PaAgentModelInput,
    type PaAgentModelStreamChunk,
} from "../src/ai-services/pa-agent-loop";
import type { AgentEvent } from "../src/ai-services/chat-types";

describe("PaAgentLoop", () => {
    beforeEach(() => {
        deterministicCounters.clear();
    });

    it("emits the canonical direct-answer lifecycle and commits text only after assistant message end", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: Array<{ snapshot: string; lastEventType?: AgentEvent["type"] }> = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: () => streamChunks([
                    { type: "text_delta", text: "Hello " },
                    { type: "text_delta", text: "world" },
                ]),
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
            onCommittedFinalText: (snapshot) => {
                committedSnapshots.push({ snapshot, lastEventType: events.at(-1)?.type });
            },
        });

        const result = await loop.run();

        expect(eventTypes(events)).toEqual([
            "agent_start",
            "turn_start",
            "message_start",
            "message_end",
            "message_start",
            "message_update",
            "message_update",
            "message_update",
            "message_update",
            "message_end",
            "turn_end",
            "agent_end",
        ]);
        expect(messageRoles(events)).toEqual(["user", "user", "assistant", "assistant"]);
        expect(events[0]).toMatchObject({
            type: "agent_start",
            scope: "run",
            turnId: RUN_SCOPE_TURN_ID,
        });
        expect(events.at(-1)).toMatchObject({
            type: "agent_end",
            scope: "run",
            turnId: RUN_SCOPE_TURN_ID,
            status: "completed",
            metadata: { finalTurnId: "turn_1" },
        });
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            type: "turn_end",
            status: "completed",
        });
        expect(committedSnapshots).toEqual([{ snapshot: "Hello world", lastEventType: "message_end" }]);
        expect(result.committedFinalText).toBe("Hello world");
    });

    it("records diagnostic stream chunks as metrics without counting them as model output chunks", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: () => streamChunks([
                    { type: "diagnostic", diagnostic: { type: "model_input_metrics", inputChars: 12 } },
                    { type: "text_delta", text: "Hello" },
                ]),
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        await loop.run();

        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            metadata: {
                modelChunkCount: 1,
                metrics: [expect.objectContaining({ type: "model_input_metrics", inputChars: 12 })],
            },
        });
        expect(events.find((event) => event.type === "turn_end")).not.toMatchObject({
            metadata: {
                diagnostics: [expect.objectContaining({ type: "model_input_metrics" })],
            },
        });
    });

    it("publishes end-to-end timing in the agent_end payload", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "use memory",
            model: {
                stream: async function* (input) {
                    if (input.turnIndex === 0) {
                        yield {
                            type: "toolcall_delta",
                            id: "call_1",
                            name: "search_memory",
                            input: { query: "周至" },
                            index: 0,
                        } as const;
                        return;
                    }
                    yield { type: "text_delta", text: "Answer from memory." } as const;
                },
            },
            toolExecutor: {
                execute: async () => ({
                    outcome: "success",
                    promptText: "Memory observation.",
                }),
            },
            hostPolicy: {
                afterTurn: (summary) => summary.status === "tool_results_ready"
                    ? { action: "continue", reason: "tool_results_ready" }
                    : { action: "stop", status: "completed", reason: "done" },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();
        const agentEnd = events.find((event) => event.type === "agent_end");

        expect(agentEnd).toMatchObject({
            type: "agent_end",
            status: "completed",
            metadata: {
                loopElapsedMs: expect.any(Number),
                turnCount: 2,
                endTiming: {
                    elapsedMs: expect.any(Number),
                    turnCount: 2,
                    toolCallCount: 1,
                    executedToolCallCount: 1,
                },
                turnTimings: [
                    expect.objectContaining({
                        turnIndex: 0,
                        status: "tool_results_ready",
                        toolCallCount: 1,
                        toolResultCount: 1,
                        toolNames: ["search_memory"],
                        toolOutcomes: [
                            expect.objectContaining({
                                toolName: "search_memory",
                                outcome: "success",
                                isError: false,
                                includeInNextPrompt: true,
                            }),
                        ],
                    }),
                    expect.objectContaining({
                        turnIndex: 1,
                        status: "completed",
                        toolCallCount: 0,
                    }),
                ],
            },
        });
        expect(result.endPayload).toMatchObject({
            loopElapsedMs: expect.any(Number),
            turnCount: 2,
            endTiming: expect.objectContaining({
                turnCount: 2,
                toolCallCount: 1,
                executedToolCallCount: 1,
            }),
            turnTimings: expect.any(Array),
        });
    });

    it("keeps thinking deltas out of committed final answer snapshots", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = createLoop({
            events,
            committedSnapshots,
            chunks: [
                { type: "thinking_delta", text: "I should reason first. " },
                { type: "text_delta", text: "Final answer." },
            ],
        });

        const result = await loop.run();

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: "message_update",
                update: { kind: "thinking_delta", text: "I should reason first. " },
            }),
        ]));
        expect(committedSnapshots).toEqual(["Final answer."]);
        expect(result.committedFinalText).toBe("Final answer.");
        expect(result.transcript.find((message) => message.role === "assistant")).toMatchObject({
            content: [
                { type: "thinking", text: "I should reason first. " },
                { type: "text", text: "Final answer." },
            ],
        });
    });

    it("reclassifies pending text when a synthetic toolcall appears and emits structured no-executor toolResult", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = createLoop({
            events,
            committedSnapshots,
            chunks: [
                { type: "text_delta", text: "I will check Memory first." },
                {
                    type: "toolcall_delta",
                    id: "call_1",
                    name: "search_memory",
                    input: { query: "launch notes" },
                    index: 0,
                },
            ],
        });

        const result = await loop.run();

        expect(committedSnapshots).toEqual([]);
        expect(result.committedFinalText).toBe("");
        expect(result.status).toBe("incomplete");
        expect(events.some((event) => event.type === "tool_execution_start")).toBe(true);
        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            outcome: "recoverable_error",
        });
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            type: "turn_end",
            status: "tool_results_ready",
            toolResults: [expect.objectContaining({ toolCallId: "call_1" })],
        });
        expect(result.turns[0]).toMatchObject({
            pendingTextReclassified: true,
            diagnostics: [],
            toolResults: [expect.objectContaining({
                content: expect.objectContaining({
                    metadata: expect.objectContaining({ reason: "missing_tool_executor" }),
                }),
            })],
        });
        expect(result.turns[0].assistantMessage.content).toEqual([
            { type: "thinking", text: "I will check Memory first." },
            { type: "toolCall", id: "call_1", name: "search_memory", input: { query: "launch notes" }, index: 0 },
        ]);
    });

    it("lets HostPolicy continue to a follow-up turn without re-emitting the user message", async () => {
        const events: AgentEvent[] = [];
        const modelInputs: PaAgentModelInput[] = [];
        const policyObservedLastEventTypes: Array<AgentEvent["type"] | undefined> = [];
        const model: PaAgentModel = {
            stream: async function* (input) {
                modelInputs.push(input);
                yield {
                    type: "text_delta",
                    text: input.turnIndex === 0 ? "First pass. " : "Final pass.",
                };
            },
        };
        let decisions = 0;
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "answer with follow-up",
            model,
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
            hostPolicy: {
                afterTurn: () => {
                    policyObservedLastEventTypes.push(events.at(-1)?.type);
                    decisions += 1;
                    return decisions === 1
                        ? { action: "continue", reason: "needs_follow_up", runtimeInstruction: "one more turn" }
                        : { action: "stop", status: "completed", reason: "done" };
                },
            },
        });

        const result = await loop.run();

        expect(events.filter((event) => event.type === "turn_start")).toHaveLength(2);
        expect(events.filter((event) => event.type === "message_start" && event.message.role === "user")).toHaveLength(1);
        expect(events.filter((event) => event.type === "message_end" && event.message.role === "user")).toHaveLength(1);
        expect(modelInputs.map((input) => input.turnIndex)).toEqual([0, 1]);
        expect(modelInputs[1]).toMatchObject({
            runtimeInstruction: "one more turn",
            transcript: expect.arrayContaining([
                expect.objectContaining({ role: "user", content: "answer with follow-up" }),
                expect.objectContaining({ role: "assistant" }),
            ]),
        });
        expect(policyObservedLastEventTypes).toEqual(["turn_end", "turn_end"]);
        expect(result.committedFinalText).toBe("First pass. Final pass.");
    });

    it("passes HostPolicy final-answer-only mode to the follow-up turn", async () => {
        const events: AgentEvent[] = [];
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "answer from observations",
            model: {
                stream: async function* (input) {
                    modelInputs.push(input);
                    yield {
                        type: "text_delta",
                        text: input.turnIndex === 0 ? "Draft." : "Final.",
                    };
                },
            },
            hostPolicy: {
                afterTurn: (summary) => summary.turnIndex === 0
                    ? {
                        action: "continue",
                        reason: "needs_follow_up",
                        runtimeInstruction: "finalize without tools",
                        toolMode: "final_answer_only",
                    }
                    : { action: "stop", status: "completed", reason: "done" },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        await loop.run();

        expect(modelInputs.map((input) => input.toolMode)).toEqual([undefined, "final_answer_only"]);
        expect(events.find((event) =>
            event.type === "turn_start" && event.metadata?.turnIndex === 1,
        )).toMatchObject({
            metadata: {
                runtimeInstruction: "finalize without tools",
                toolMode: "final_answer_only",
            },
        });
    });

    it("passes control snapshots to model input and turn metadata", async () => {
        const events: AgentEvent[] = [];
        const modelInputs: PaAgentModelInput[] = [];
        const initialControlSnapshot = createAgentControlSnapshot({
            exposureMode: "source-scoped",
            sourceScope: "notes",
            allowedToolNames: new Set(["search_memory"]),
            blockedToolNames: new Set(["webSearch"]),
        });
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "find from notes",
            model: {
                stream: async function* (input) {
                    modelInputs.push(input);
                    yield {
                        type: "text_delta",
                        text: input.turnIndex === 0 ? "Draft." : "Final.",
                    };
                },
            },
            hostPolicy: {
                afterTurn: (summary) => summary.turnIndex === 0
                    ? {
                        action: "continue",
                        reason: "needs_follow_up",
                        runtimeInstruction: "finalize from gathered context",
                        toolMode: "final_answer_only",
                    }
                    : { action: "stop", status: "completed", reason: "done" },
            },
            initialControlSnapshot,
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        await loop.run();

        expect(modelInputs[0]?.controlSnapshot).toMatchObject({
            exposureMode: "source-scoped",
            sourceScope: "notes",
        });
        expect([...modelInputs[0]!.controlSnapshot!.allowedToolNames!]).toEqual(["search_memory"]);
        expect([...modelInputs[0]!.controlSnapshot!.blockedToolNames!]).toEqual(["webSearch"]);
        expect(modelInputs[1]?.controlSnapshot).toMatchObject({
            exposureMode: "final-only",
            sourceScope: "none",
            runtimeInstruction: "finalize from gathered context",
            toolMode: "final_answer_only",
        });
        expect(modelInputs[1]?.controlSnapshot?.allowedToolNames).toBeUndefined();
        expect(events.find((event) =>
            event.type === "turn_start" && event.metadata?.turnIndex === 0,
        )).toMatchObject({
            metadata: {
                controlSnapshot: {
                    exposureMode: "source-scoped",
                    sourceScope: "notes",
                    allowedToolNames: ["search_memory"],
                    blockedToolNames: ["webSearch"],
                },
            },
        });
        expect(events.find((event) =>
            event.type === "turn_start" && event.metadata?.turnIndex === 1,
        )).toMatchObject({
            metadata: {
                controlSnapshot: {
                    exposureMode: "final-only",
                    sourceScope: "none",
                    toolMode: "final_answer_only",
                },
                runtimeInstruction: "finalize from gathered context",
                toolMode: "final_answer_only",
            },
        });
        const turnEndEvents = events.filter((event) => event.type === "turn_end");
        expect(turnEndEvents[0]).toMatchObject({
            metadata: {
                elapsedMs: expect.any(Number),
                modelElapsedMs: expect.any(Number),
                firstModelChunkElapsedMs: expect.any(Number),
                modelChunkCount: 1,
                toolCallCount: 0,
                toolResultCount: 0,
                controlSnapshot: {
                    exposureMode: "source-scoped",
                    sourceScope: "notes",
                    allowedToolNames: ["search_memory"],
                    blockedToolNames: ["webSearch"],
                },
            },
        });
        expect(turnEndEvents[1]).toMatchObject({
            metadata: {
                elapsedMs: expect.any(Number),
                modelElapsedMs: expect.any(Number),
                firstModelChunkElapsedMs: expect.any(Number),
                modelChunkCount: 1,
                toolCallCount: 0,
                toolResultCount: 0,
                controlSnapshot: {
                    exposureMode: "final-only",
                    sourceScope: "none",
                    toolMode: "final_answer_only",
                },
            },
        });
    });

    it("creates semantic-first and narrowed-required initial control snapshots", () => {
        const semanticFirst = createInitialAgentControlSnapshot({
            availableSemanticToolNames: new Set(["search_memory", "webSearch", "get_current_note_context"]),
        });
        expect(semanticFirst).toMatchObject({
            exposureMode: "semantic-first",
            sourceScope: "mixed",
        });
        expect([...semanticFirst.allowedToolNames!].sort()).toEqual([
            "get_current_note_context",
            "search_memory",
            "webSearch",
        ]);

        const narrowedRequired = createInitialAgentControlSnapshot({
            availableSemanticToolNames: new Set(["search_memory", "webSearch", "get_current_note_context"]),
            availableMetaToolNames: new Set(["load_skill"]),
            requiredToolNames: new Set(["webSearch"]),
        });
        expect(narrowedRequired).toMatchObject({
            exposureMode: "narrowed-required",
            sourceScope: "web",
        });
        expect([...narrowedRequired.allowedToolNames!].sort()).toEqual(["load_skill", "webSearch"]);

        const notesOnly = createInitialAgentControlSnapshot({
            availableSemanticToolNames: new Set(["search_memory", "webSearch", "get_current_note_context"]),
            availableMetaToolNames: new Set(["load_skill"]),
            constraints: {
                allowedToolNames: new Set(["search_memory"]),
                blockedToolNames: new Set(["webSearch", "get_current_note_context"]),
            },
        });
        expect(notesOnly).toMatchObject({
            exposureMode: "source-scoped",
            sourceScope: "notes",
        });
        expect([...notesOnly.allowedToolNames!].sort()).toEqual(["load_skill", "search_memory"]);
        expect([...notesOnly.blockedToolNames!].sort()).toEqual(["get_current_note_context", "webSearch"]);

        const requiredSourceBlocked = createInitialAgentControlSnapshot({
            availableSemanticToolNames: new Set(["search_memory", "get_current_note_context"]),
            availableMetaToolNames: new Set(["load_skill"]),
            requiredToolNames: new Set(["webSearch"]),
        });
        expect(requiredSourceBlocked).toMatchObject({
            exposureMode: "semantic-first",
            sourceScope: "mixed",
        });
        expect([...requiredSourceBlocked.allowedToolNames!].sort()).toEqual([
            "get_current_note_context",
            "load_skill",
            "search_memory",
        ]);
    });

    it("turns no-first-chunk idle into incomplete without an empty answer", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: { stream: () => neverStream() },
            createId: createDeterministicId,
            now: () => 100,
            assistantIdleTimeoutMs: 1,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result).toMatchObject({
            status: "incomplete",
            committedFinalText: "",
        });
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "assistant_idle_timeout" })] },
        });
        expect(events.at(-1)).toMatchObject({ type: "agent_end", status: "incomplete" });
    });

    it("turns thinking-only idle into incomplete without committing answer text", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = createLoop({
            events,
            committedSnapshots,
            chunks: [{ type: "thinking_delta", text: "Still thinking." }],
            neverAfterChunks: true,
            assistantIdleTimeoutMs: 1,
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(committedSnapshots).toEqual([]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "assistant_idle_timeout" })] },
        });
    });

    it("turns a normally ended thinking-only stream into incomplete diagnostics", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = createLoop({
            events,
            committedSnapshots,
            chunks: [{ type: "thinking_delta", text: "I am considering context." }],
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(result.committedFinalText).toBe("");
        expect(committedSnapshots).toEqual([]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "assistant_empty_response" })] },
        });
        expect(events.at(-1)).toMatchObject({
            type: "agent_end",
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "assistant_empty_response" })] },
        });
    });

    it("turns an immediately empty assistant stream into incomplete diagnostics", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = createLoop({
            events,
            committedSnapshots,
            chunks: [],
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(result.committedFinalText).toBe("");
        expect(committedSnapshots).toEqual([]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "assistant_empty_response" })] },
        });
    });

    it("preserves pending text with a warning when assistant idle fires", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = createLoop({
            events,
            committedSnapshots,
            chunks: [{ type: "text_delta", text: "Partial answer." }],
            neverAfterChunks: true,
            assistantIdleTimeoutMs: 1,
        });

        const result = await loop.run();

        expect(result.status).toBe("completed_with_warning");
        expect(committedSnapshots).toEqual(["Partial answer."]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "completed_with_warning",
            metadata: { diagnostics: [expect.objectContaining({ type: "assistant_idle_timeout" })] },
        });
    });

    it("does not execute a partial toolcall when assistant idle fires", async () => {
        const events: AgentEvent[] = [];
        const loop = createLoop({
            events,
            committedSnapshots: [],
            chunks: [{ type: "toolcall_delta", id: "call_1", name: "search_memory", argsText: "{\"query\"", index: 0 }],
            neverAfterChunks: true,
            assistantIdleTimeoutMs: 1,
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(events.some((event) => event.type === "tool_execution_start")).toBe(false);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: {
                diagnostics: expect.arrayContaining([
                    expect.objectContaining({ type: "assistant_idle_timeout" }),
                    expect.objectContaining({ type: "tool_required" }),
                ]),
            },
        });
    });

    it("resets assistant idle on thinking, text, and toolcall deltas", async () => {
        const events: AgentEvent[] = [];
        const loop = createLoop({
            events,
            committedSnapshots: [],
            chunks: [
                { type: "thinking_delta", text: "Thinking. " },
                { type: "text_delta", text: "Need a tool." },
                { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "x" }, index: 0 },
            ],
            chunkDelayMs: 1,
            assistantIdleTimeoutMs: 20,
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(JSON.stringify(result.turns[0].diagnostics)).not.toContain("assistant_idle_timeout");
        expect(result.turns[0].toolResults).toEqual([
            expect.objectContaining({
                content: expect.objectContaining({
                    metadata: expect.objectContaining({ reason: "missing_tool_executor" }),
                }),
            }),
        ]);
    });

    it("preserves partial text with a warning when provider errors after visible text", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "Partial answer." } as const;
                    throw new Error("provider failed");
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
            onCommittedFinalText: (snapshot) => committedSnapshots.push(snapshot),
        });

        const result = await loop.run();

        expect(result.status).toBe("completed_with_warning");
        expect(committedSnapshots).toEqual(["Partial answer."]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "completed_with_warning",
            metadata: { diagnostics: [expect.objectContaining({ type: "provider_error" })] },
        });
    });

    it("returns error when provider fails before visible text", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    throw new Error("provider failed");
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("error");
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "error",
            metadata: { diagnostics: [expect.objectContaining({ type: "provider_error" })] },
        });
        expect(events.at(-1)).toMatchObject({ type: "agent_end", status: "error" });
    });

    it("converts synchronous provider stream setup failure into canonical terminal events", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: () => {
                    throw new Error("setup failed");
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("error");
        expect(eventTypes(events).slice(-3)).toEqual(["message_end", "turn_end", "agent_end"]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "error",
            metadata: { diagnostics: [expect.objectContaining({ type: "provider_error", message: "setup failed" })] },
        });
    });

    it("preserves visible partial text on user abort while ending the run as aborted", async () => {
        const events: AgentEvent[] = [];
        const committedSnapshots: string[] = [];
        const controller = new AbortController();
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "Partial answer." } as const;
                    controller.abort();
                    await new Promise(() => undefined);
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            signal: controller.signal,
            onEvent: (event) => events.push(event),
            onCommittedFinalText: (snapshot) => committedSnapshots.push(snapshot),
        });

        const result = await loop.run();

        expect(result.status).toBe("aborted");
        expect(committedSnapshots).toEqual(["Partial answer."]);
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({ status: "aborted" });
        expect(events.at(-1)).toMatchObject({ type: "agent_end", status: "aborted" });
    });

    it("allows turn 20 and blocks attempted turn 21 before turn_start", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "loop",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "." } as const;
                },
            },
            hostPolicy: {
                afterTurn: () => ({ action: "continue", reason: "needs_follow_up" }),
            },
            maxTurns: 20,
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(events.filter((event) => event.type === "turn_start")).toHaveLength(20);
        expect(events.filter((event) => event.type === "turn_start").at(-1)).toMatchObject({
            turnId: "turn_20",
        });
        expect(events.at(-1)).toMatchObject({
            type: "agent_end",
            status: "incomplete",
            metadata: { reason: "max_turns_exceeded", maxTurns: 20, finalTurnId: "turn_20" },
        });
    });

    it("stops on wall-clock expiry before starting the next turn", async () => {
        const events: AgentEvent[] = [];
        let now = 0;
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "First." } as const;
                },
            },
            hostPolicy: {
                afterTurn: () => {
                    now = 20;
                    return { action: "continue", reason: "needs_follow_up" };
                },
            },
            maxWallClockMs: 10,
            createId: createDeterministicId,
            now: () => now,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(events.filter((event) => event.type === "turn_start")).toHaveLength(1);
        expect(events.at(-1)).toMatchObject({
            type: "agent_end",
            status: "incomplete",
            metadata: { reason: "wall_clock_exceeded" },
        });
    });

    it("stops on wall-clock expiry while waiting for HostPolicy after a turn", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "First." } as const;
                },
            },
            hostPolicy: {
                afterTurn: async () => {
                    await new Promise(() => undefined);
                    return { action: "continue", reason: "needs_follow_up" };
                },
            },
            maxWallClockMs: 1,
            createId: createDeterministicId,
            now: () => 0,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(events.filter((event) => event.type === "turn_start")).toHaveLength(1);
        expect(events.at(-1)).toMatchObject({
            type: "agent_end",
            status: "incomplete",
            metadata: { reason: "wall_clock_exceeded" },
        });
    });

    it("converts HostPolicy rejection into canonical error agent_end", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "First." } as const;
                },
            },
            hostPolicy: {
                afterTurn: async () => {
                    throw new Error("policy failed");
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("error");
        expect(events.at(-1)).toMatchObject({
            type: "agent_end",
            status: "error",
            metadata: {
                reason: "host_policy_error",
                warnings: [expect.objectContaining({ type: "host_policy_error", message: "policy failed" })],
            },
        });
    });

    it("stops on wall-clock expiry while waiting for assistant stream before idle", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: { stream: () => neverStream() },
            createId: createDeterministicId,
            now: () => 0,
            assistantIdleTimeoutMs: 1000,
            maxWallClockMs: 1,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(result.transcript.find((message) => message.role === "assistant")).toMatchObject({
            stopReason: "wall_clock_exceeded",
        });
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "wall_clock_exceeded" })] },
        });
        expect(JSON.stringify(result.turns[0].diagnostics)).not.toContain("assistant_idle_timeout");
    });

    it("executes buffered toolcalls only after assistant message end and emits ordered toolResult messages", async () => {
        const events: AgentEvent[] = [];
        const executorInputs: unknown[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "search memory",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", argsText: "{\"query\":" },
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", argsText: "\"launch\"}", index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorInputs.push(toolCall.input);
                    return {
                        outcome: "success",
                        promptText: "Memory result.",
                        previewText: "Memory preview.",
                    };
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();
        const assistantMessageEndIndex = events.findIndex((event) =>
            event.type === "message_end" && event.message.role === "assistant");
        const toolStartIndex = events.findIndex((event) => event.type === "tool_execution_start");
        const toolEnd = events.find((event) => event.type === "tool_execution_end");
        const turnEnd = events.find((event) => event.type === "turn_end");

        expect(assistantMessageEndIndex).toBeGreaterThan(-1);
        expect(toolStartIndex).toBeGreaterThan(assistantMessageEndIndex);
        expect(executorInputs).toEqual([{ query: "launch" }]);
        expect(toolEnd).toMatchObject({
            outcome: "success",
            toolCallId: "call_1",
            toolName: "search_memory",
        });
        expect(result.turns[0]).toMatchObject({ status: "tool_results_ready" });
        expect(result.turns[0].toolResults).toHaveLength(1);
        expect(result.turns[0].toolResults[0]).toMatchObject({
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "search_memory",
            isError: false,
            content: {
                promptText: "Memory result.",
                previewText: "Memory preview.",
                includeInNextPrompt: true,
            },
        });
        expect(turnEnd).toMatchObject({
            status: "tool_results_ready",
            toolResults: [expect.objectContaining({ toolCallId: "call_1" })],
        });
    });

    it("rejects tool calls outside the current control snapshot before invoking executor", async () => {
        const events: AgentEvent[] = [];
        const executorCalls: string[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "search notes",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_vault_metadata", input: { query: "x" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorCalls.push(toolCall.name);
                    return { outcome: "success", promptText: "should not run" };
                },
            },
            initialControlSnapshot: createAgentControlSnapshot({
                exposureMode: "semantic-first",
                sourceScope: "notes",
                allowedToolNames: new Set(["search_memory"]),
            }),
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(executorCalls).toEqual([]);
        expect(result.turns[0].toolResults[0]).toMatchObject({
            toolName: "search_vault_metadata",
            isError: true,
            content: {
                metadata: {
                    outcome: "policy_rejected",
                    reason: "control_snapshot_tool_not_allowed",
                    exposureMode: "semantic-first",
                    sourceScope: "notes",
                    allowedToolNames: ["search_memory"],
                },
            },
        });
        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            toolName: "search_vault_metadata",
            outcome: "policy_rejected",
            metadata: expect.objectContaining({
                preflightOnly: true,
            }),
        });
    });

    it("executes multiple toolcalls in assistant index order even when deltas arrive out of order", async () => {
        const executorOrder: string[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "ordered tools",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_2", name: "webSearch", input: { query: "second" }, index: 1 },
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "first" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorOrder.push(toolCall.id);
                    return { outcome: "success", promptText: toolCall.id };
                },
            },
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(executorOrder).toEqual(["call_1", "call_2"]);
        expect(result.turns[0].toolResults.map((message) => message.toolCallId)).toEqual(["call_1", "call_2"]);
    });

    it("turns synchronous tool executor throws into paired recoverable_error toolResults", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "sync throw tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "x" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute() {
                    throw new Error("sync boom");
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(eventTypes(events)).toEqual(expect.arrayContaining([
            "tool_execution_start",
            "tool_execution_end",
            "message_start",
            "message_end",
            "turn_end",
            "agent_end",
        ]));
        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            outcome: "recoverable_error",
        });
        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError: true,
            content: {
                promptText: "Tool search_memory failed: sync boom",
                metadata: expect.objectContaining({ outcome: "recoverable_error", reason: "tool_exception" }),
            },
        });
    });

    it("injects toolResult transcript before a HostPolicy follow-up answer", async () => {
        const events: AgentEvent[] = [];
        const modelInputs: PaAgentModelInput[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "use a tool",
            model: {
                stream: async function* (input) {
                    modelInputs.push(input);
                    if (input.turnIndex === 0) {
                        yield {
                            type: "toolcall_delta",
                            id: "call_1",
                            name: "search_memory",
                            input: { query: "launch" },
                            index: 0,
                        } as const;
                        return;
                    }
                    yield { type: "text_delta", text: "Final from tool." } as const;
                },
            },
            toolExecutor: {
                execute: async () => ({
                    outcome: "success",
                    promptText: "Tool observation.",
                }),
            },
            hostPolicy: {
                afterTurn: (summary) => summary.status === "tool_results_ready"
                    ? { action: "continue", reason: "tool_results_ready" }
                    : { action: "stop", status: "completed", reason: "done" },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("completed");
        expect(result.committedFinalText).toBe("Final from tool.");
        expect(modelInputs).toHaveLength(2);
        expect(modelInputs[1].transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: "toolResult", content: expect.objectContaining({ promptText: "Tool observation." }) }),
        ]));
        expect(events.filter((event) => event.type === "message_start" && event.message.role === "user")).toHaveLength(1);
    });

    it("turns invalid toolcall JSON into schema_invalid toolResult without invoking the executor", async () => {
        const events: AgentEvent[] = [];
        const executorInputs: unknown[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "bad tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", argsText: "{\"query\"", index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorInputs.push(toolCall.input);
                    return { outcome: "success", promptText: "should not run" };
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(executorInputs).toEqual([]);
        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            outcome: "schema_invalid",
            metadata: expect.objectContaining({ preflightOnly: true }),
        });
        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError: true,
            content: {
                includeInNextPrompt: true,
                metadata: expect.objectContaining({ outcome: "schema_invalid" }),
            },
        });
    });

    it("allows tool call 30 and budget-skips attempted tool call 31 without invoking the executor", async () => {
        const events: AgentEvent[] = [];
        const executorInputs: unknown[] = [];
        const chunks: PaAgentModelStreamChunk[] = Array.from({ length: 31 }, (_, index) => ({
            type: "toolcall_delta" as const,
            id: `call_${index + 1}`,
            name: "search_memory",
            input: { query: `q${index + 1}` },
            index,
        }));
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "many tools",
            model: { stream: () => streamChunks(chunks) },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorInputs.push(toolCall.input);
                    return { outcome: "success", promptText: `ok ${executorInputs.length}` };
                },
            },
            maxToolCalls: 30,
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();
        const toolEndOutcomes = events
            .filter((event) => event.type === "tool_execution_end")
            .map((event) => event.outcome);

        expect(executorInputs).toHaveLength(30);
        expect(toolEndOutcomes).toHaveLength(31);
        expect(toolEndOutcomes.slice(0, 30)).toEqual(Array(30).fill("success"));
        expect(toolEndOutcomes[30]).toBe("budget_exceeded");
        expect(result.turns[0].toolResults[30]).toMatchObject({
            toolCallId: "call_31",
            isError: true,
            content: {
                includeInNextPrompt: true,
                metadata: expect.objectContaining({ outcome: "budget_exceeded", maxToolCalls: 30 }),
            },
        });
    });

    it("budget-skips every remaining toolcall after maxToolCalls is exhausted", async () => {
        const executorInputs: unknown[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "budget remaining",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "allowed" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "allowed" }, index: 1 },
                    { type: "toolcall_delta", id: "call_3", name: "webSearch", argsText: "{\"query\"", index: 2 },
                    { type: "toolcall_delta", id: "call_4", name: "webSearch", input: { query: "later" }, index: 3 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorInputs.push(toolCall.input);
                    return { outcome: "success", promptText: "ok" };
                },
            },
            maxToolCalls: 1,
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(executorInputs).toEqual([{ query: "allowed" }]);
        expect(result.turns[0].toolResults.map((message) => message.content.metadata?.outcome)).toEqual([
            "success",
            "budget_exceeded",
            "budget_exceeded",
            "budget_exceeded",
        ]);
    });

    it("truncates prompt observations across toolResults without dropping structured source metadata", async () => {
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "two tools",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "a" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "webSearch", input: { query: "b" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => ({
                    outcome: "success",
                    promptText: toolCall.id === "call_1" ? "abc" : "defgh",
                    sourceRecords: [{
                        kind: toolCall.name === "webSearch" ? "web-source" : "memory-reference",
                        dedupKey: toolCall.id,
                        sourceBoundary: toolCall.name === "webSearch" ? "web" : "memory",
                        title: toolCall.name,
                    }],
                    contextUsed: [{
                        category: toolCall.name === "webSearch" ? "read-only-tool" : "memory",
                        label: toolCall.name,
                    }],
                }),
            },
            maxObservationChars: 5,
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(result.turns[0].toolResults.map((message) => message.content.promptText)).toEqual(["abc", "de"]);
        expect(result.turns[0].toolResults[1]).toMatchObject({
            content: {
                sourceRecords: [expect.objectContaining({ dedupKey: "call_2", sourceBoundary: "web" })],
                contextUsed: [expect.objectContaining({ label: "webSearch" })],
                metadata: expect.objectContaining({
                    observationTruncated: true,
                    originalPromptTextLength: 5,
                    maxObservationChars: 5,
                }),
            },
        });
    });

    it("turns duplicate toolcalls into duplicate_skipped toolResults without invoking the executor twice", async () => {
        const executorInputs: unknown[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "duplicate tools",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "same" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "same" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorInputs.push(toolCall.input);
                    return { outcome: "success", promptText: "ok" };
                },
            },
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(executorInputs).toEqual([{ query: "same" }]);
        expect(result.turns[0].toolResults.map((message) => message.content.metadata?.outcome)).toEqual([
            "success",
            "duplicate_skipped",
        ]);
        expect(result.turns[0].toolResults[1]).toMatchObject({
            isError: false,
            content: { includeInNextPrompt: false, promptText: "" },
        });
    });

    it("converts tool exceptions into recoverable_error toolResults and continues best-effort", async () => {
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "tool fails",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "fail" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "webSearch", input: { query: "ok" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    if (toolCall.id === "call_1") {
                        throw new Error("boom");
                    }
                    return { outcome: "success", promptText: "ok" };
                },
            },
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(result.turns[0].toolResults.map((message) => message.content.metadata?.outcome)).toEqual([
            "recoverable_error",
            "success",
        ]);
        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError: true,
            content: {
                includeInNextPrompt: true,
                promptText: "Tool search_memory failed: boom",
            },
        });
    });

    it("turns tool-specific timeout into the configured tool outcome", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "slow tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "slow" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async () => {
                    await new Promise(() => undefined);
                    return { outcome: "success", promptText: "late" };
                },
            },
            toolTimeoutMs: 1,
            toolTimeoutOutcome: "policy_rejected",
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            outcome: "policy_rejected",
        });
        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError: true,
            content: {
                includeInNextPrompt: true,
                metadata: expect.objectContaining({ outcome: "policy_rejected", reason: "tool_timeout", timeoutMs: 1 }),
            },
        });
    });

    it("preserves executor-returned policy_rejected toolResult contract", async () => {
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "policy rejected",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "webSearch", input: { query: "blocked" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async () => ({
                    outcome: "policy_rejected",
                    promptText: "The tool was rejected by policy.",
                    previewText: "Rejected.",
                    metadata: { reason: "network_disabled" },
                }),
            },
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError: true,
            content: {
                promptText: "The tool was rejected by policy.",
                previewText: "Rejected.",
                includeInNextPrompt: true,
                metadata: expect.objectContaining({ outcome: "policy_rejected", reason: "network_disabled" }),
            },
        });
    });

    it.each([
        { outcome: "success" as const, includeInNextPrompt: true, isError: false },
        { outcome: "recoverable_error" as const, includeInNextPrompt: true, isError: true },
        { outcome: "schema_invalid" as const, includeInNextPrompt: true, isError: true },
        { outcome: "policy_rejected" as const, includeInNextPrompt: true, isError: true },
        { outcome: "budget_exceeded" as const, includeInNextPrompt: true, isError: true },
        { outcome: "duplicate_skipped" as const, includeInNextPrompt: false, isError: false },
        { outcome: "aborted" as const, includeInNextPrompt: false, isError: true },
        { outcome: "abort_timeout" as const, includeInNextPrompt: false, isError: true },
    ])("normalizes $outcome toolResult prompt inclusion and error contract", async ({ outcome, includeInNextPrompt, isError }) => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: `${outcome} tool`,
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: outcome }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async () => ({
                    outcome,
                    promptText: `${outcome} prompt`,
                    previewText: `${outcome} preview`,
                }),
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            outcome,
            metadata: expect.objectContaining({ isError }),
        });
        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError,
            content: {
                promptText: includeInNextPrompt ? `${outcome} prompt` : "",
                previewText: `${outcome} preview`,
                includeInNextPrompt,
                metadata: expect.objectContaining({ outcome }),
            },
        });
    });

    it("emits aborted toolResult when a tool responds to user abort before grace expires", async () => {
        const controller = new AbortController();
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "abort responsive tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "slow" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async ({ signal }) => {
                    controller.abort();
                    if (signal.aborted) {
                        throw new Error("aborted promptly");
                    }
                    return { outcome: "success", promptText: "late" };
                },
            },
            signal: controller.signal,
            toolAbortGraceMs: 100,
            toolTimeoutMs: 1000,
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(result.status).toBe("aborted");
        expect(result.turns[0].toolResults[0]).toMatchObject({
            isError: true,
            content: {
                includeInNextPrompt: false,
                metadata: expect.objectContaining({ outcome: "aborted", reason: "user_abort" }),
            },
        });
    });

    it("emits abort_timeout toolResult when user aborts during an unresponsive tool", async () => {
        const events: AgentEvent[] = [];
        const controller = new AbortController();
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "abort tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "slow" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "webSearch", input: { query: "skip" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async () => {
                    controller.abort();
                    await new Promise(() => undefined);
                    return { outcome: "success", promptText: "late" };
                },
            },
            signal: controller.signal,
            toolAbortGraceMs: 1,
            toolTimeoutMs: 1000,
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("aborted");
        expect(result.turns[0].toolResults).toHaveLength(1);
        expect(result.turns[0].toolResults[0]).toMatchObject({
            toolCallId: "call_1",
            isError: true,
            content: {
                includeInNextPrompt: false,
                metadata: expect.objectContaining({ outcome: "abort_timeout", reason: "user_abort" }),
            },
        });
        expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
            outcome: "abort_timeout",
        });
        expect(events.some((event) => event.type === "tool_execution_start" && event.toolCallId === "call_2")).toBe(false);
    });

    it("wall-clock deadline aborts tool execution and stops remaining tools", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "wall clock tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "slow" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "webSearch", input: { query: "skip" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async () => {
                    await new Promise(() => undefined);
                    return { outcome: "success", promptText: "late" };
                },
            },
            maxWallClockMs: 1,
            toolAbortGraceMs: 1,
            toolTimeoutMs: 1000,
            createId: createDeterministicId,
            now: () => 0,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(result.turns[0].toolResults).toHaveLength(1);
        expect(result.turns[0].toolResults[0]).toMatchObject({
            content: {
                metadata: expect.objectContaining({
                    outcome: "abort_timeout",
                    reason: "wall_clock_exceeded",
                    stoppedBy: "wall_clock_exceeded",
                }),
            },
        });
        expect(events.find((event) => event.type === "turn_end")).toMatchObject({
            status: "incomplete",
            metadata: { diagnostics: [expect.objectContaining({ type: "wall_clock_exceeded" })] },
        });
        expect(events.some((event) => event.type === "tool_execution_start" && event.toolCallId === "call_2")).toBe(false);
    });

    it("does not run assistant idle while a tool is executing", async () => {
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "slow tool without assistant idle",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "slow" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async () => {
                    await new Promise(() => undefined);
                    return { outcome: "success", promptText: "late" };
                },
            },
            assistantIdleTimeoutMs: 1,
            toolTimeoutMs: 5,
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(result.turns[0].toolResults[0].content.metadata).toMatchObject({
            reason: "tool_timeout",
        });
        expect(JSON.stringify(result.turns[0].diagnostics)).not.toContain("assistant_idle_timeout");
    });

    it("discards late tool results after abort timeout", async () => {
        const events: AgentEvent[] = [];
        const controller = new AbortController();
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "late abort tool",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "slow" }, index: 0 },
                ]),
            },
            toolExecutor: {
                execute: async () => {
                    controller.abort();
                    await delay(10);
                    return { outcome: "success", promptText: "late success" };
                },
            },
            signal: controller.signal,
            toolAbortGraceMs: 1,
            toolTimeoutMs: 1000,
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();
        const eventCountAtEnd = events.length;
        await delay(20);

        expect(result.turns[0].toolResults[0].content.metadata).toMatchObject({
            outcome: "abort_timeout",
            reason: "user_abort",
        });
        expect(events).toHaveLength(eventCountAtEnd);
        expect(result.turns[0].toolResults[0].content.promptText).toBe("");
    });
});

describe("PaAgentLoop hybrid tool execution (P0-A)", () => {
    beforeEach(() => {
        deterministicCounters.clear();
    });

    it("runs two parallel-mode tools concurrently in hybrid dispatch", async () => {
        const events: AgentEvent[] = [];
        const concurrent = { active: 0, peak: 0 };
        const release: Array<() => void> = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "parallel tools",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "a" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "b" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    concurrent.active += 1;
                    concurrent.peak = Math.max(concurrent.peak, concurrent.active);
                    await new Promise<void>((resolve) => release.push(resolve));
                    concurrent.active -= 1;
                    return { outcome: "success", promptText: `result:${toolCall.id}` };
                },
                getExecutionMode: () => "parallel",
            },
            toolExecutionMode: "hybrid",
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const runPromise = loop.run();
        // Wait for both executes to be in-flight; release them only after we've seen the peak.
        while (release.length < 2) {
            await delay(1);
        }
        release.forEach((fn) => fn());
        const result = await runPromise;

        expect(concurrent.peak).toBe(2);
        // toolExecutionStart emitted in parsed order before launch.
        const startEvents = events.filter((event) => event.type === "tool_execution_start");
        expect(startEvents.map((event) => event.toolCallId)).toEqual(["call_1", "call_2"]);
        // toolResults emitted in parsed order despite concurrent execution.
        expect(result.turns[0].toolResults.map((message) => message.toolCallId)).toEqual(["call_1", "call_2"]);
        expect(result.turns[0].toolResults.map((message) => message.content.promptText)).toEqual([
            "result:call_1",
            "result:call_2",
        ]);
    });

    it("forces sequential when any tool reports executionMode='sequential' in hybrid mode", async () => {
        const executorOrder: Array<{ id: string; phase: "enter" | "exit" }> = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "mixed dispatch",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "a" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "write_thing", input: { value: "b" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorOrder.push({ id: toolCall.id, phase: "enter" });
                    await delay(5);
                    executorOrder.push({ id: toolCall.id, phase: "exit" });
                    return { outcome: "success", promptText: toolCall.id };
                },
                getExecutionMode: (name) => name === "write_thing" ? "sequential" : "parallel",
            },
            toolExecutionMode: "hybrid",
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        // Sequential dispatch ⇒ tool_2 doesn't enter until tool_1 exits.
        expect(executorOrder).toEqual([
            { id: "call_1", phase: "enter" },
            { id: "call_1", phase: "exit" },
            { id: "call_2", phase: "enter" },
            { id: "call_2", phase: "exit" },
        ]);
        expect(result.turns[0].toolResults.map((message) => message.toolCallId)).toEqual(["call_1", "call_2"]);
    });

    it("falls back to parallel when executor omits getExecutionMode in hybrid mode", async () => {
        const concurrent = { active: 0, peak: 0 };
        const release: Array<() => void> = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "no execution mode",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "a" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "b" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    concurrent.active += 1;
                    concurrent.peak = Math.max(concurrent.peak, concurrent.active);
                    await new Promise<void>((resolve) => release.push(resolve));
                    concurrent.active -= 1;
                    return { outcome: "success", promptText: toolCall.id };
                },
            },
            toolExecutionMode: "hybrid",
            createId: createDeterministicId,
            now: () => 100,
        });

        const runPromise = loop.run();
        while (release.length < 2) {
            await delay(1);
        }
        release.forEach((fn) => fn());
        const result = await runPromise;

        expect(concurrent.peak).toBe(2);
        expect(result.turns[0].toolResults.map((message) => message.toolCallId)).toEqual(["call_1", "call_2"]);
    });

    it("abort during parallel batch emits one toolResult per launched tool (no early-skip)", async () => {
        const events: AgentEvent[] = [];
        const controller = new AbortController();
        const release: Array<() => void> = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "parallel abort",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "a" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "b" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async () => {
                    await new Promise<void>((resolve) => release.push(resolve));
                    return { outcome: "success", promptText: "late" };
                },
            },
            signal: controller.signal,
            toolAbortGraceMs: 1,
            toolTimeoutMs: 1000,
            toolExecutionMode: "parallel",
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const runPromise = loop.run();
        while (release.length < 2) {
            await delay(1);
        }
        controller.abort();
        // Let the abort + grace timeout race resolve before we release the pending awaits.
        await delay(20);
        release.forEach((fn) => fn());
        const result = await runPromise;

        // pi parallel contract: both tools launched → both have toolExecutionStart + toolResult.
        const startEvents = events.filter((event) => event.type === "tool_execution_start");
        expect(startEvents.map((event) => event.toolCallId)).toEqual(["call_1", "call_2"]);
        expect(result.turns[0].toolResults).toHaveLength(2);
        for (const message of result.turns[0].toolResults) {
            expect(message.content.metadata).toMatchObject({
                outcome: "abort_timeout",
                reason: "user_abort",
                stoppedBy: "aborted",
            });
        }
        expect(result.status).toBe("aborted");
    });

    it("parallel pre-flight enforces budget cap deterministically in input order", async () => {
        let executedCount = 0;
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "parallel budget",
            maxToolCalls: 2,
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "a" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "b" }, index: 1 },
                    { type: "toolcall_delta", id: "call_3", name: "search_memory", input: { query: "c" }, index: 2 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executedCount += 1;
                    return { outcome: "success", promptText: toolCall.id };
                },
            },
            toolExecutionMode: "parallel",
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(executedCount).toBe(2);
        const outcomes = result.turns[0].toolResults.map((message) => message.content.metadata?.outcome);
        expect(outcomes).toEqual(["success", "success", "budget_exceeded"]);
        expect(result.turns[0].toolResults[2].content.metadata).toMatchObject({
            outcome: "budget_exceeded",
            maxToolCalls: 2,
        });
    });

    it("parallel pre-flight deduplicates identical tool calls before launching real executes", async () => {
        let executedCount = 0;
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "parallel dedup",
            model: {
                stream: () => streamChunks([
                    { type: "toolcall_delta", id: "call_1", name: "search_memory", input: { query: "same" }, index: 0 },
                    { type: "toolcall_delta", id: "call_2", name: "search_memory", input: { query: "same" }, index: 1 },
                ]),
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executedCount += 1;
                    return { outcome: "success", promptText: toolCall.id };
                },
            },
            toolExecutionMode: "parallel",
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(executedCount).toBe(1);
        const outcomes = result.turns[0].toolResults.map((message) => message.content.metadata?.outcome);
        expect(outcomes).toEqual(["success", "duplicate_skipped"]);
    });
});

describe("PaAgentLoop endPayload diagnostics (P0-C)", () => {
    beforeEach(() => {
        deterministicCounters.clear();
    });

    it("captures the provider_error diagnostic on the result so callers can re-throw with context", async () => {
        const events: AgentEvent[] = [];
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    throw new Error("provider failed");
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        const result = await loop.run();

        expect(result.status).toBe("error");
        expect(result.endPayload).toMatchObject({
            reason: "error",
            diagnostics: [expect.objectContaining({ type: "provider_error", message: "provider failed" })],
        });
        // The endPayload mirrors what was emitted to listeners — the runtime can JSON.stringify it
        // into an Error message and recover the same context that observability already saw.
        const agentEnd = events.at(-1);
        expect(agentEnd).toMatchObject({ type: "agent_end", status: "error" });
        expect((agentEnd as { metadata: Record<string, unknown> }).metadata).toMatchObject({
            reason: "error",
            diagnostics: [expect.objectContaining({ type: "provider_error" })],
        });
    });

    it("surfaces the wall_clock_exceeded diagnostic on the result when the timer fires mid-stream", async () => {
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: { stream: () => neverStream() },
            createId: createDeterministicId,
            now: () => 100,
            maxWallClockMs: 5,
            assistantIdleTimeoutMs: 60_000,
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        // The wall_clock guard fires inside the model stream (not the outer turn guard) — so the
        // reason is the soft turn status while the actual cause is preserved in `diagnostics`.
        expect(result.endPayload).toMatchObject({
            reason: "incomplete",
            diagnostics: [expect.objectContaining({ type: "wall_clock_exceeded", maxWallClockMs: 5 })],
        });
    });

    it("captures max_turns_exceeded reason + budget when the loop exits the turn cap", async () => {
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "." } as const;
                },
            },
            hostPolicy: {
                afterTurn: () => ({ action: "continue", reason: "needs_follow_up" }),
            },
            createId: createDeterministicId,
            now: () => 100,
            maxTurns: 2,
        });

        const result = await loop.run();

        expect(result.status).toBe("incomplete");
        expect(result.endPayload).toMatchObject({
            reason: "max_turns_exceeded",
            maxTurns: 2,
        });
    });

    it("surfaces the user_abort diagnostic on the result when an in-stream abort fires", async () => {
        const controller = new AbortController();
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "hello",
            model: {
                stream: async function* () {
                    yield { type: "text_delta", text: "Partial." } as const;
                    controller.abort();
                    await new Promise(() => undefined);
                },
            },
            signal: controller.signal,
            createId: createDeterministicId,
            now: () => 100,
        });

        const result = await loop.run();

        expect(result.status).toBe("aborted");
        // Mid-stream abort routes through the turn handler — `reason` is the turn status, the
        // user_abort cause lives in diagnostics. The outer-loop user_abort branch (covered by
        // the "early abort" suite) emits `reason: "user_abort"` directly.
        expect(result.endPayload).toMatchObject({
            reason: "aborted",
            diagnostics: [expect.objectContaining({ type: "user_abort" })],
        });
    });
});

describe("PaAgentLoop final_answer_only executor guard (#8)", () => {
    beforeEach(() => {
        deterministicCounters.clear();
    });

    it("rejects any tool call with policy_rejected when toolMode=final_answer_only and never invokes the executor", async () => {
        const events: AgentEvent[] = [];
        const executorCalls: string[] = [];

        // Turn 0: assistant produces a draft, hostPolicy then forces final_answer_only.
        // Turn 1: model still hallucinates a tool call against the empty schema list — the guard
        // must reject it (not silently execute) so observability/audit see "model violated".
        const loop = new PaAgentLoop({
            runId: "run_1",
            userInput: "answer only",
            model: {
                stream: async function* (input) {
                    if (input.turnIndex === 0) {
                        yield { type: "text_delta", text: "Draft." };
                    } else {
                        yield {
                            type: "toolcall_delta",
                            id: "call_1",
                            name: "search_memory",
                            input: { query: "should not run" },
                            index: 0,
                        };
                    }
                },
            },
            hostPolicy: {
                afterTurn: (summary) => summary.turnIndex === 0
                    ? {
                        action: "continue",
                        reason: "needs_follow_up",
                        runtimeInstruction: "finalize without tools",
                        toolMode: "final_answer_only",
                    }
                    : { action: "stop", status: "completed", reason: "done" },
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executorCalls.push(toolCall.name);
                    return { outcome: "success", promptText: "should not be reached" };
                },
            },
            createId: createDeterministicId,
            now: () => 100,
            onEvent: (event) => events.push(event),
        });

        await loop.run();

        // Executor never ran — the guard short-circuits ahead of executeRealToolCall.
        expect(executorCalls).toEqual([]);

        // The buffered tool call still gets paired start/end events so the lifecycle stays
        // consistent and the toolResult is emitted with policy_rejected outcome.
        const toolStart = events.find((event) => event.type === "tool_execution_start");
        const toolEnd = events.find((event) => event.type === "tool_execution_end");
        expect(toolStart).toMatchObject({
            toolCallId: "call_1",
            toolName: "search_memory",
        });
        expect(toolEnd).toMatchObject({
            toolCallId: "call_1",
            toolName: "search_memory",
            outcome: "policy_rejected",
        });

        // The toolResult message itself records the violation reason so the model sees it as an
        // observation and can produce a corrective final answer next turn.
        const turn1ToolResult = events
            .filter((event) => event.type === "message_end" && event.message.role === "toolResult")
            .at(-1) as { message: { content: { metadata?: Record<string, unknown>; includeInNextPrompt?: boolean } } } | undefined;
        expect(turn1ToolResult).toBeDefined();
        expect(turn1ToolResult?.message.content.metadata).toMatchObject({
            outcome: "policy_rejected",
            reason: "final_answer_only_violation",
            toolName: "search_memory",
        });
        // policy_rejected defaults to includeInNextPrompt=true so the model learns from the error.
        expect(turn1ToolResult?.message.content.includeInNextPrompt).toBe(true);
    });
});

function createLoop(options: {
    events: AgentEvent[];
    committedSnapshots: string[];
    chunks: PaAgentModelStreamChunk[];
    chunkDelayMs?: number;
    assistantIdleTimeoutMs?: number;
    neverAfterChunks?: boolean;
}): PaAgentLoop {
    return new PaAgentLoop({
        runId: "run_1",
        userInput: "hello",
        model: {
            stream: () => streamChunks(options.chunks, options.chunkDelayMs, options.neverAfterChunks),
        },
        createId: createDeterministicId,
        now: () => 100,
        onEvent: (event) => options.events.push(event),
        onCommittedFinalText: (snapshot) => options.committedSnapshots.push(snapshot),
        assistantIdleTimeoutMs: options.assistantIdleTimeoutMs,
    });
}

async function* streamChunks(
    chunks: PaAgentModelStreamChunk[],
    delayMs = 0,
    neverAfterChunks = false,
): AsyncIterable<PaAgentModelStreamChunk> {
    for (const chunk of chunks) {
        if (delayMs > 0) {
            await delay(delayMs);
        }
        yield chunk;
    }
    if (neverAfterChunks) {
        await new Promise(() => undefined);
    }
}

async function* neverStream(): AsyncIterable<PaAgentModelStreamChunk> {
    await new Promise(() => undefined);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeterministicId(prefix: string): string {
    const next = deterministicCounters.get(prefix) ?? 1;
    deterministicCounters.set(prefix, next + 1);
    return `${prefix}_${next}`;
}

const deterministicCounters = new Map<string, number>();

function eventTypes(events: AgentEvent[]): Array<AgentEvent["type"]> {
    return events.map((event) => event.type);
}

function messageRoles(events: AgentEvent[]): string[] {
    return events
        .filter((event) => event.type === "message_start" || event.type === "message_end")
        .map((event) => event.message.role);
}
