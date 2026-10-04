import { describe, expect, it, jest } from "@jest/globals";

import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type { ChatToolDefinition, ChatToolResult } from "../src/ai-services/chat-tools";
import {
    createPaAgentCommandCapabilityScope,
    paAgentWritingCommandDefinition,
} from "../src/ai-services/pa-agent-command";
import {
    chatToolResultToPaAgentToolExecutionResult,
    createPaAgentCapabilityToolExecutor,
} from "../src/ai-services/pa-agent-host-tools";
import { createRequiredCapabilityHostPolicy } from "../src/ai-services/pa-agent-required-capability-policy";
import { PaAgentLoop, type PaAgentModelInput } from "../src/ai-services/pa-agent-loop";

jest.mock("obsidian");

describe("PA Agent command capability scope", () => {
    it("uses command definitions without inventing an execution requirement for Writing", () => {
        expect(paAgentWritingCommandDefinition.capabilityNames).toEqual([]);
        expect(paAgentWritingCommandDefinition.agentGuidance.length).toBeGreaterThan(0);
    });

    it("releases only capabilities successfully registered by this scope", () => {
        const registry = new CapabilityRegistry();
        const firstScope = createPaAgentCommandCapabilityScope(registry);
        const secondScope = createPaAgentCommandCapabilityScope(registry);
        const owned = createChatToolCapability(createReadTool("read_note"), { providerId: "scope-owner" });
        const duplicate = createChatToolCapability(createReadTool("read_note"), { providerId: "scope-duplicate" });
        const unrelated = createChatToolCapability(
            createReadTool("list_recent_notes", "unrelated"),
            { providerId: "scope-other" },
        );

        expect(firstScope.register(owned)).toBe(true);
        expect(secondScope.register(duplicate)).toBe(false);
        expect(secondScope.register(unrelated)).toBe(true);
        secondScope.dispose();

        expect(registry.get("read_note")).toBe(owned);
        expect(registry.has("list_recent_notes")).toBe(false);
        firstScope.dispose();
        expect(registry.has("read_note")).toBe(false);
    });
});

describe("PA Agent command effect bridge through the real tool chain", () => {
    it("reuses a succeeded operation and preserves owner recovery", async () => {
        const { result, execute } = await runToolChain("succeeded", [
            { value: "same" },
            { value: "same" },
        ]);
        const toolResults = result.turns.flatMap(turn => turn.toolResults);

        expect(result.status).toBe("completed");
        expect(execute).toHaveBeenCalledTimes(1);
        expect(toolResults).toHaveLength(2);
        expect(toolResults[0].content.metadata).toMatchObject({ executionState: "succeeded" });
        expect(toolResults[1].content.metadata).toMatchObject({
            outcome: "reused_result",
            executionState: "succeeded",
            reason: "successful_result_reused",
        });
        expect(toolResults[1].content.metadata?.recovery).toEqual({
            code: "owner_recovery",
            allowedActions: ["query_operation"],
            operationId: "owner-operation",
        });
    });

    it("blocks replay after an owner-unknown side-effect failure without replacing the owner fact", async () => {
        const { result, execute } = await runToolChain("owner-unknown", [
            { value: "same" },
            { value: "same" },
        ]);
        const toolResults = result.turns.flatMap(turn => turn.toolResults);

        expect(result.status).toBe("completed");
        expect(execute).toHaveBeenCalledTimes(1);
        expect(toolResults[0].content.metadata).toMatchObject({
            executionState: "acceptance_unknown",
            retrySafety: "side_effect",
        });
        expect(JSON.parse(toolResults[0].content.promptText).execution).toMatchObject({
            executionState: "acceptance_unknown",
            recovery: {
                code: "operation_acceptance_unknown",
                allowedActions: ["query_operation", "needs_user"],
            },
        });
        expect(toolResults[0].content.resultFact).toEqual({
            kind: "unknown",
            operationId: "owner-operation",
        });
        expect(toolResults[0].content.promptText).not.toContain("owner-operation");
        expect(toolResults[1].content.metadata).toMatchObject({
            executionState: "acceptance_unknown",
            reason: "unknown_replay_blocked",
            replayBlocked: true,
        });
    });

    it("keeps owner partial effects and recovery actions distinct from a replay attempt", async () => {
        const { result, execute } = await runToolChain("partial", [
            { value: "same" },
            { value: "same" },
        ]);
        const toolResults = result.turns.flatMap(turn => turn.toolResults);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(toolResults[1].content.metadata).toMatchObject({
            executionState: "partially_succeeded",
            reason: "partial_replay_blocked",
        });
        expect(toolResults[1].content.metadata?.recovery).toMatchObject({
            code: "owner_partial",
            allowedActions: ["query_operation"],
            operationId: "owner-operation",
            completedParts: ["first"],
            remainingParts: ["second"],
        });
        expect(toolResults[1].content.promptText).not.toContain("owner-operation");
        expect(toolResults[1].content.promptText).not.toContain("completedParts");
    });

    it("keeps the provider recovery projection bounded while retaining complete Host facts", () => {
        const longCode = "C".repeat(10_000);
        const completedParts = Array.from({ length: 1_000 }, (_, index) => `completed-${index}-` + "P".repeat(180));
        const remainingParts = Array.from({ length: 1_000 }, (_, index) => `remaining-${index}-` + "R".repeat(180));
        const repeatedActions = Array.from({ length: 10_000 }, () => "query_operation" as const);
        const execution = chatToolResultToPaAgentToolExecutionResult(
            { type: "toolCall", id: "call-long-recovery", index: 0, name: "create_image",
                input: { prompt: "draw" } },
            {
                ok: true,
                tool: "create_image",
                inputSummary: "draw",
                content: { status: "accepted" },
                sources: [],
                executionState: "partially_succeeded",
                recovery: {
                    code: longCode,
                    allowedActions: repeatedActions,
                    operationId: "owner-operation",
                    completedParts,
                    remainingParts,
                },
            },
        );
        const observation = JSON.parse(execution.promptText).execution;

        expect(execution.recovery?.code).toHaveLength(10_000);
        expect(execution.recovery?.completedParts).toHaveLength(1_000);
        expect(execution.recovery?.remainingParts).toHaveLength(1_000);
        expect(execution.recovery?.allowedActions).toHaveLength(10_000);
        expect(observation.recovery.code).toHaveLength(64);
        expect(observation.recovery).toMatchObject({
            codeTruncated: true,
            partsTruncated: true,
            completedPartsOmitted: 992,
            remainingPartsOmitted: 992,
        });
        expect(observation.recovery.completedParts).toHaveLength(8);
        expect(observation.recovery.remainingParts).toHaveLength(8);
        expect(observation.recovery.allowedActions).toEqual(["query_operation"]);
        expect(observation.recovery.completedParts?.[0]).toHaveLength(48);
        expect(execution.promptText.length).toBeLessThan(2_000);
        expect(execution.promptText).not.toContain("owner-operation");
    });

    it("allows argument correction only before schema validation executes the tool", async () => {
        const { result, execute } = await runToolChain("succeeded", [
            { wrong: true },
            { value: "corrected" },
        ]);
        const toolResults = result.turns.flatMap(turn => turn.toolResults);

        expect(result.status).toBe("completed");
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith({ value: "corrected" }, expect.anything());
        expect(toolResults[0].content.metadata).toMatchObject({
            outcome: "schema_invalid",
            executionState: "not_started",
        });
        expect(toolResults[0].content.metadata?.recovery).toMatchObject({
            allowedActions: ["correct_input"],
        });
        expect(toolResults[1].content.metadata).toMatchObject({ executionState: "succeeded" });
    });

    it("treats an entered side-effect throw as acceptance unknown without inventing readonly execution facts", async () => {
        const sideEffect = await runToolChain("throw-side-effect", [{ value: "same" }]);
        const readOnly = await runToolChain("throw-read-only", [
            { value: "same" },
            { value: "same" },
        ]);
        const sideResult = sideEffect.result.turns[0]?.toolResults[0];
        const readResults = readOnly.result.turns.flatMap(turn => turn.toolResults);

        expect(sideResult?.content.metadata).toMatchObject({
            executionState: "acceptance_unknown",
            retrySafety: "side_effect",
        });
        expect(sideResult?.content.metadata?.recovery).toMatchObject({
            allowedActions: ["query_operation", "needs_user"],
        });
        expect(sideResult?.content.promptText).toContain("Verify the existing operation");
        expect(readOnly.execute).toHaveBeenCalledTimes(2);
        expect(readResults).toHaveLength(2);
        for (const readResult of readResults) {
            expect(readResult.content.metadata).toMatchObject({
                outcome: "recoverable_error",
                retrySafety: "read_only",
            });
            expect(readResult.content.metadata?.outcome).not.toBe("reused_result");
            expect(readResult.content.metadata?.reason).not.toBe("unknown_replay_blocked");
            expect(readResult.content.metadata).not.toHaveProperty("executionState");
            expect(readResult.content.metadata).not.toHaveProperty("recovery");
        }
    });
});

type EffectMode = "succeeded" | "owner-unknown" | "partial"
    | "throw-side-effect" | "throw-read-only";

async function runToolChain(mode: EffectMode, calls: Array<Record<string, unknown>>) {
    const execute = jest.fn(async (input: { value?: string }, context: unknown) => {
        void context;
        if (mode === "throw-side-effect" || mode === "throw-read-only") {
            throw new Error("the wording says nothing happened");
        }
        return toolResult(mode, input.value ?? "");
    });
    const registry = new CapabilityRegistry();
    const definition = mode === "throw-read-only"
        ? createReadTool("read_note", "read", execute as never)
        : createImageTool(execute);
    const capability = createChatToolCapability(definition, {
        providerId: mode === "throw-read-only" ? "core-tools" : "chat-image-generation",
        platform: "desktop",
    });
    capability.executionMode = "sequential";
    registry.register(capability);
    const host = { settings: {}, log: () => undefined } as never;
    const executor = createPaAgentCapabilityToolExecutor({ registry, host });
    const providerInputs: PaAgentModelInput[] = [];
    let turn = 0;
    const result = await new PaAgentLoop({
        runId: `command-${mode}`,
        userInput: "Use the command tool.",
        maxTurns: calls.length + 2,
        toolExecutor: executor,
        hostPolicy: createRequiredCapabilityHostPolicy().hostPolicy,
        model: {
            stream: async function* (input: PaAgentModelInput) {
                providerInputs.push(input);
                const call = calls[turn++];
                if (call) {
                    yield { type: "toolcall_delta", id: `call-${turn}`, index: 0,
                        name: definition.name, input: call } as const;
                    yield { type: "provider_completion", completion: "tool_calls" } as const;
                } else {
                    yield { type: "text_delta", text: "Done with the command fact." } as const;
                    yield { type: "provider_completion", completion: "stop" } as const;
                }
            },
        },
    }).run();
    return { result, execute, providerInputs, toolResults: result.turns.flatMap(turn => turn.toolResults) };
}

function toolResult(mode: EffectMode, value: string): ChatToolResult<unknown> {
    if (mode === "owner-unknown") {
        return {
            ok: false,
            tool: "create_image",
            inputSummary: value,
            content: null,
            sources: [],
            error: "Owner acceptance is unknown.",
            resultFact: { kind: "unknown", operationId: "owner-operation" },
        };
    }
    return {
        ok: true,
        tool: "create_image",
        inputSummary: value,
        content: { status: "accepted" },
        sources: [],
        resultFact: { kind: "accepted", action: "image", operationId: "owner-operation" },
        executionState: mode === "partial" ? "partially_succeeded" : "succeeded",
        recovery: mode === "partial"
            ? {
                code: "owner_partial",
                allowedActions: ["query_operation"],
                operationId: "owner-operation",
                completedParts: ["first"],
                remainingParts: ["second"],
            }
            : {
                code: "owner_recovery",
                allowedActions: ["query_operation"],
                operationId: "owner-operation",
            },
    };
}

function createImageTool(
    execute: ChatToolDefinition<Record<string, unknown>, unknown>["execute"],
): ChatToolDefinition<{ value: string }, unknown> {
    return {
        name: "create_image",
        description: "Synthetic command-owned image operation.",
        inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
        },
        plannerGuidance: ["Synthetic test tool."],
        permission: "image-generation",
        cost: "ai-calls",
        outputBudgetChars: 1000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Preparing synthetic image operation",
        sourceBoundary: "read-only-tool",
        statusMessage: () => "Preparing synthetic image operation",
        validateInput: raw => {
            if (!raw || typeof raw !== "object" || typeof (raw as { value?: unknown }).value !== "string") {
                throw new Error("value must be a string");
            }
            return { value: (raw as { value: string }).value };
        },
        execute,
    };
}

function createReadTool(
    name: "read_note" | "list_recent_notes",
    value = "read",
    execute?: ChatToolDefinition<Record<string, unknown>, unknown>["execute"],
): ChatToolDefinition<Record<string, unknown>, unknown> {
    return {
        name,
        description: "Synthetic read-only command tool.",
        inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            additionalProperties: false,
        },
        plannerGuidance: ["Synthetic test tool."],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 1000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading synthetic input",
        sourceBoundary: "read-only-tool",
        statusMessage: () => "Reading synthetic input",
        validateInput: () => ({ value }),
        execute: execute ?? (async () => ({
            ok: true,
            tool: name,
            inputSummary: value,
            content: { value },
            sources: [],
        })),
    };
}
