import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import { chatToolResultToPaAgentToolExecutionResult } from "../src/ai-services/pa-agent-host-tools";
import { collectActionStates, cloneActionStates, projectActionSummaryFacts, type PaAgentActionState } from "../src/ai-services/pa-agent-result-facts";
import { projectPaAgentActionHistory, actionHistoryMessages } from "../src/ai-services/pa-agent-action-history";
import { createExecuteObsidianCodeRuntime } from "../src/ai-services/independent-computation/obsidian-code-runtime";
import type { PaAgentToolExecutionResult } from "../src/ai-services/pa-agent-types";
import type { VmLauncher } from "../src/third_party/pi-codemode/runtime/execution";

jest.mock("obsidian");

const lineage = completeInputLineage([{ kind: "user-text", messageId: "user" }]);

function imageState(index: number): PaAgentActionState {
    return { schemaVersion: 1, owner: "image", operationId: `task-${index}`, phase: "accepted",
        origin: { runId: "run", turnId: "turn", assistantId: "assistant", callId: `child-${index}`, resultId: `result-${index}` },
        revision: 0, inputLineage: lineage, receipt: { kind: "image-accepted", taskId: `task-${index}` } };
}

function imageOwnerResult(taskId: string): PaAgentToolExecutionResult {
    return { outcome: "success", executionState: "succeeded", includeInNextPrompt: true,
        promptText: JSON.stringify({ tool: "create_image", status: "ok", input: "generate; count:1",
            observation: { status: "accepted", taskId } }),
        metadata: { inputSummary: "generate; count:1" }, resultFact: { kind: "accepted", action: "image", operationId: taskId } };
}

function imageCapability() {
    return createChatToolCapability({ name: "create_image", description: "Controlled original image owner",
        inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false },
        plannerGuidance: [], permission: "image-generation", cost: "ai-calls", outputBudgetChars: 1_000,
        requiresConfirmation: false, failureBehavior: "recoverable", statusMessageText: "Image", sourceBoundary: "read-only-tool",
        statusMessage: () => "Image", validateInput: raw => raw as { prompt: string },
        execute: async () => { throw new Error("Use the original final executor in this controlled fixture."); },
    }, { providerId: "fixture-image-owner" });
}

describe("composed owner continuity through the original loop", () => {
    it.each([
        { tool: "obsidian.workspace.open", status: "succeeded", phase: "completed", effect: { kind: "open", opened: true } },
        { tool: "obsidian.workspace.open", status: "partial", phase: "partial", effect: { kind: "open", opened: true } },
        { tool: "obsidian.vault.mkdir", status: "succeeded", phase: "completed", effect: { kind: "mkdir", paths: ["new"] } },
        { tool: "obsidian.vault.mkdir", status: "partial", phase: "partial", effect: { kind: "mkdir", paths: ["new"] } },
        { tool: "obsidian.operations.undo", status: "succeeded", phase: "completed", effect: { kind: "undo", undoStatus: "undone" } },
    ])("preserves owner $tool/$status effects without inventing an Undo receipt", ({ tool, status, phase, effect }) => {
        const observation = { intentId: "intent", state: phase, undoAvailable: false, operations: [{ operationId: "operation", toolCallId: "child",
            status, resourceEffect: effect }] };
        const states = collectActionStates({ runId: "run", turnId: "turn", messages: [
            { role: "assistant", id: "assistant", timestamp: 0,
                content: [{ type: "toolCall", id: "child", name: tool, input: {}, index: 0 }] },
            { role: "toolResult", id: "result", toolCallId: "child", toolName: tool, timestamp: 0, isError: status === "partial",
                inputLineage: lineage, content: { includeInNextPrompt: true,
                    promptText: JSON.stringify({ ok: status === "succeeded", value: observation,
                        ...(status === "partial" ? { error: { code: "partial", message: "Partial owner effect" } } : {}) }),
                    resultFact: { kind: "operations_result", observation } as never,
                    metadata: { operationsOwnerResult: true, sdkOnly: true } } },
        ] });
        expect(states).toEqual([expect.objectContaining({ owner: "operations", operationId: "intent", phase,
            operationsUndoAvailable: false, actions: [expect.objectContaining({ resourceEffect: effect })] })]);
        expect(states[0].actions![0].receiptId).toBeUndefined();
        expect(projectActionSummaryFacts(states)[0].actions![0].resourceEffect).toEqual(effect);
    });

    it("keeps a known unknown Operations identity as a finite queryable receipt", () => {
        const state: PaAgentActionState = { schemaVersion: 1, owner: "operations", operationId: "intent-unknown", phase: "unknown",
            origin: { runId: "run", turnId: "turn", assistantId: "assistant", callId: "child", resultId: "result" }, revision: 0,
            inputLineage: lineage, receipt: { kind: "operations-unknown", intentId: "intent-unknown" } };
        expect(cloneActionStates([state])).toEqual([state]);
        expect(cloneActionStates([{ ...state, phase: "completed" }])).toEqual([]);
    });

    it("keeps all 257 valid child facts through parent emission, collection and next provider history", async () => {
        const states = Array.from({ length: 257 }, (_, index) => imageState(index));
        let nextHistory = "";
        let modelTurns = 0;
        const result = await new PaAgentLoop({ runId: "run", userInput: "Complete the authorized task", maxTurns: 2,
            model: { stream: async function* (input) {
                if (++modelTurns === 1) {
                    yield { type: "toolcall_delta", id: "parent", name: "execute_obsidian_code", input: { code: "return 1", mode: "apply" }, index: 0 } as const;
                    yield { type: "provider_completion", completion: "tool_calls" } as const;
                } else {
                    nextHistory = JSON.stringify(actionHistoryMessages(projectPaAgentActionHistory(input.transcript), "native"));
                    yield { type: "text_delta", text: "Done" } as const;
                    yield { type: "provider_completion", completion: "stop" } as const;
                }
            } },
            toolExecutor: { getRetrySafety: () => "side_effect", execute: async () => ({
                outcome: "success", promptText: "1", actionStates: states, inputLineage: lineage,
            }) },
            hostPolicy: { afterTurn: summary => summary.toolResults.length > 0
                ? { action: "continue", reason: "tool_results_ready" }
                : { action: "stop", status: "completed", reason: "text_present" } },
        }).run();
        expect(result.turns[0].toolResults[0].actionStates).toHaveLength(257);
        expect(collectActionStates({ runId: "run", turnId: "turn", messages: result.transcript })).toHaveLength(257);
        for (const state of states) expect(nextHistory).toContain(state.operationId);
        expect(nextHistory).toContain("childEffects");
        expect(nextHistory).not.toContain("inputLineage");
        expect(result.transcript.filter(message => message.role === "toolResult")).toHaveLength(1);
    });

    it("preserves finite child facts when an already-returned result races its tool deadline", async () => {
        let now = 0;
        const state = imageState(1);
        const result = await new PaAgentLoop({ runId: "run", userInput: "Apply the authorized task", maxTurns: 1,
            now: () => now, remoteAttemptTimeoutMs: 100, maxWallClockMs: 1_000,
            model: { stream: async function* () {
                yield { type: "toolcall_delta", id: "parent", name: "execute_obsidian_code", input: {}, index: 0 } as const;
            } },
            toolExecutor: { getRetrySafety: () => "side_effect", execute: async () => {
                now = 101;
                return { outcome: "success", promptText: "Untrusted program output", executionState: "succeeded",
                    actionStates: [state], inputLineage: lineage };
            } },
        }).run();
        expect(result.turns[0].toolResults[0].actionStates).toEqual([state]);
        expect(result.turns[0].toolResults[0].inputLineage).toEqual(lineage);
        expect(result.turns[0].toolResults[0].content.metadata?.reason).toBe("tool_timeout");
    });

    it("retains a confirmed owner before rejecting its oversized observation body", async () => {
        const registry = new CapabilityRegistry();
        registry.register(imageCapability());
        const owner = imageOwnerResult("large-body-task");
        owner.promptText += " ".repeat(2_000_001);
        let reply: unknown;
        const launcher: VmLauncher = (_data, events) => {
            queueMicrotask(() => events.message({ type: "call", id: 1, target: "tool", name: "create_image", args: "{}" }));
            return { post: message => {
                reply = JSON.parse(message.payload!);
                events.message({ type: "done", ok: true, value: "1", writes: "[]" });
            }, stop: async () => undefined };
        };
        const runtime = createExecuteObsidianCodeRuntime({ runId: "run", turnId: "turn", turnIndex: 0,
            userInput: "Create the authorized image", parentToolCallId: "parent", parentAssistantId: "assistant",
            parentInputLineage: lineage, registry, launcher, getExecutor: () => ({ execute: async () => owner }) });
        const result = await runtime.execute({ code: "return 1", mode: "apply" }, { host: { log: () => undefined } as never });
        expect(reply).toMatchObject({ error: { code: "owner_result_budget_exceeded", executionState: "succeeded" } });
        expect(result.actionStates).toEqual([expect.objectContaining({ operationId: "large-body-task", phase: "accepted" })]);
    });

    it("Stop after VM return preserves an accepted child while a later owner ignores cancellation", async () => {
        const registry = new CapabilityRegistry();
        registry.register(imageCapability());
        const controller = new AbortController();
        let release!: () => void;
        const lingering = new Promise<PaAgentToolExecutionResult>(resolve => { release = () => resolve(imageOwnerResult("late-task")); });
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        let stoppedVm!: () => void;
        const vmStopped = new Promise<void>(resolve => { stoppedVm = resolve; });
        const launcher: VmLauncher = (_data, events) => {
            queueMicrotask(() => events.message({ type: "call", id: 1, target: "tool", name: "create_image", args: "{}" }));
            return { post: message => {
                if (message.id !== 1) return;
                events.message({ type: "call", id: 2, target: "tool", name: "create_image", args: "{}" });
                void started.then(() => events.message({ type: "done", ok: true, value: "1", writes: "[]" }));
            }, stop: async () => { stoppedVm(); } };
        };
        let owners = 0;
        const runtime = createExecuteObsidianCodeRuntime({ runId: "run", turnId: "turn", turnIndex: 0,
            userInput: "Create both authorized images", parentToolCallId: "parent", parentAssistantId: "assistant",
            parentInputLineage: lineage, registry, launcher, getExecutor: () => ({
                getRetrySafety: () => "side_effect", execute: async () => {
                    if (++owners === 1) return imageOwnerResult("accepted-task");
                    markStarted();
                    return await lingering;
                },
            }) });
        const loop = new PaAgentLoop({ runId: "run", userInput: "Create both authorized images", signal: controller.signal,
            toolAbortGraceMs: 100, maxTurns: 1,
            model: { stream: async function* () {
                yield { type: "toolcall_delta", id: "parent", name: "execute_obsidian_code", input: {}, index: 0 } as const;
            } },
            toolExecutor: { getRetrySafety: () => "side_effect", execute: async input =>
                chatToolResultToPaAgentToolExecutionResult(input.toolCall,
                    await runtime.execute({ code: "return 1", mode: "apply" }, { host: { log: () => undefined } as never,
                        signal: input.signal, outerToolDeadlineAt: input.outerToolDeadlineAt })) },
        });
        const pending = loop.run();
        try {
            await vmStopped;
            controller.abort();
            const result = await pending;
            expect(result.turns[0].toolResults[0].actionStates).toEqual([
                expect.objectContaining({ operationId: "accepted-task", phase: "accepted" }),
            ]);
            expect(result.turns[0].toolResults[0].content.metadata?.executionState).toBe("acceptance_unknown");
            expect(owners).toBe(2);
        } finally { release(); await pending; }
    });
});
