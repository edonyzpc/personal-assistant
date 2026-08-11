import { toolConstraintsFromAgentControlSnapshot } from "../pa-agent-control-policy";
import { isAllowedHostToolCall } from "../pa-agent-host-tools";
import type {
    PaAgentToolBatchPreparationInput,
    PaAgentToolBatchPreparationResult,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
} from "../pa-agent-types";
import type { CapabilityRegistry } from "../capability-registry";
import { isCoreWriteToolName } from "./input-validation";
import {
    OPERATIONS_STAGED_MESSAGE,
} from "./operations-tool-provider";
import type {
    OperationsIntent,
    StageOperationsIntentInput,
} from "./types";

export interface OperationsIntentStager {
    stageIntent(
        input: StageOperationsIntentInput,
        signal?: AbortSignal,
    ): Promise<OperationsIntent> | OperationsIntent;
}

export interface OperationsStagingToolExecutorOptions {
    baseExecutor: PaAgentToolExecutor;
    registry: CapabilityRegistry;
    controller: OperationsIntentStager;
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
    onToolRunning?: (tool: string, message: string) => void;
}

/**
 * Converts one assistant action-tool phase into one immutable pending intent.
 * It deliberately has no confirmation or vault-write method: those belong to
 * the controller/UI bridge after the model turn has completed.
 */
export function createOperationsStagingToolExecutor(
    options: OperationsStagingToolExecutorOptions,
): PaAgentToolExecutor {
    return {
        getCanonicalToolCallKey: (toolCall, context) => (
            options.baseExecutor.getCanonicalToolCallKey?.(toolCall, context)
        ),
        getExecutionMode: (toolName) => (
            isCoreWriteToolName(toolName)
                ? "sequential"
                : options.baseExecutor.getExecutionMode?.(toolName)
        ),
        prepareBatch: async (input) => prepareOperationsBatch(options, input),
        execute: async (input) => {
            const capability = options.registry.get(input.toolCall.name);
            if (!capability || capability.kind !== "action" || !isCoreWriteToolName(input.toolCall.name)) {
                return options.baseExecutor.execute(input);
            }
            return {
                outcome: "policy_rejected",
                promptText: `Tool ${input.toolCall.name} was not executed because Operations actions must be staged as one assistant tool phase.`,
                previewText: `Skipped ${input.toolCall.name}; no write occurred.`,
                metadata: {
                    outcome: "policy_rejected",
                    reason: "operations_batch_required",
                    staged: false,
                    wrote: false,
                },
            };
        },
    };
}

async function prepareOperationsBatch(
    options: OperationsStagingToolExecutorOptions,
    input: PaAgentToolBatchPreparationInput,
): Promise<PaAgentToolBatchPreparationResult> {
    const baseResult = await options.baseExecutor.prepareBatch?.(input);
    const toolResults = new Map(baseResult?.toolResults ?? []);
    const actionCalls = input.toolCalls.filter((toolCall) => {
        const capability = options.registry.get(toolCall.name);
        return capability?.kind === "action" && isCoreWriteToolName(toolCall.name);
    });
    if (actionCalls.length === 0) return { toolResults };

    const activeConstraints = toolConstraintsFromAgentControlSnapshot(input.controlSnapshot);
    const preparedOperations: StageOperationsIntentInput["operations"][number][] = [];
    let invalid = false;
    for (const toolCall of actionCalls) {
        const capability = options.registry.get(toolCall.name);
        if (!capability || !isCoreWriteToolName(toolCall.name)) continue;
        const allowed = isAllowedHostToolCall(
            toolCall.name,
            activeConstraints?.allowedToolNames ?? options.allowedToolNames,
            activeConstraints?.blockedToolNames ?? options.blockedToolNames,
        );
        if (!allowed) {
            invalid = true;
            toolResults.set(toolCall.id, rejectedResult(toolCall.name, "tool_outside_user_requested_scope"));
            continue;
        }
        const policy = options.registry.canExecute(toolCall.name);
        if (!policy.allowed) {
            invalid = true;
            options.registry.recordCapabilityEvent({
                capabilityName: capability.name,
                providerId: capability.providerId,
                status: "skipped",
                durationMs: 0,
            });
            toolResults.set(toolCall.id, rejectedResult(toolCall.name, "policy_rejected", policy.reason));
            continue;
        }
        const prepared = options.registry.prepareAndValidate(toolCall.name, toolCall.input, {
            userInput: input.userInput,
        });
        if (!prepared.ok) {
            invalid = true;
            toolResults.set(toolCall.id, {
                outcome: "schema_invalid",
                promptText: `Tool ${toolCall.name} input is invalid: ${safeError(prepared.error)}. Correct the arguments and retry the complete proposal.`,
                previewText: `Invalid ${toolCall.name} proposal; no write occurred.`,
                metadata: {
                    outcome: "schema_invalid",
                    reason: "operations_schema_invalid",
                    staged: false,
                    wrote: false,
                },
            });
            continue;
        }
        preparedOperations.push({
            toolCallId: toolCall.id,
            name: toolCall.name,
            input: prepared.input,
        });
    }

    if (invalid) {
        for (const toolCall of actionCalls) {
            if (toolResults.has(toolCall.id)) continue;
            toolResults.set(toolCall.id, {
                outcome: "recoverable_error",
                promptText: `Tool ${toolCall.name} was not staged because another operation in the same proposal was invalid. Correct the complete proposal and retry.`,
                previewText: `Proposal not staged; no write occurred.`,
                metadata: {
                    outcome: "recoverable_error",
                    reason: "operations_batch_invalid",
                    staged: false,
                    wrote: false,
                },
            });
        }
        return { toolResults };
    }

    for (const toolCall of actionCalls) {
        options.onToolRunning?.(toolCall.name, `Staging ${toolCall.name} proposal...`);
    }
    try {
        const intent = await options.controller.stageIntent(
            {
                runId: input.runId,
                turnId: input.turnId,
                operations: preparedOperations,
            },
            input.signal,
        );
        for (const toolCall of actionCalls) {
            const capability = options.registry.get(toolCall.name);
            if (capability) {
                options.registry.recordCapabilityEvent({
                    capabilityName: capability.name,
                    providerId: capability.providerId,
                    status: "invoked",
                    durationMs: 0,
                });
            }
            toolResults.set(toolCall.id, {
                outcome: "success",
                promptText: OPERATIONS_STAGED_MESSAGE,
                previewText: `Staged ${toolCall.name} for inline review; no write occurred.`,
                metadata: {
                    outcome: "success",
                    intentId: intent.id,
                    operationCount: intent.operations.length,
                    staged: true,
                    wrote: false,
                },
            });
        }
    } catch (error) {
        const message = safeError(error);
        for (const toolCall of actionCalls) {
            const capability = options.registry.get(toolCall.name);
            if (capability) {
                options.registry.recordCapabilityEvent({
                    capabilityName: capability.name,
                    providerId: capability.providerId,
                    status: "failed",
                    durationMs: 0,
                });
            }
            toolResults.set(toolCall.id, {
                outcome: "recoverable_error",
                promptText: `The Operations proposal could not be staged: ${message}. No write occurred. Correct the proposal or explain the failure.`,
                previewText: `Proposal staging failed; no write occurred.`,
                metadata: {
                    outcome: "recoverable_error",
                    reason: "operations_staging_failed",
                    staged: false,
                    wrote: false,
                },
            });
        }
    }
    return { toolResults };
}

function rejectedResult(toolName: string, reason: string, detail?: string): PaAgentToolExecutionResult {
    return {
        outcome: "policy_rejected",
        promptText: `Tool ${toolName} was not staged by policy${detail ? `: ${detail}` : ""}. No write occurred.`,
        previewText: `Skipped ${toolName}; no write occurred.`,
        metadata: {
            outcome: "policy_rejected",
            reason,
            staged: false,
            wrote: false,
        },
    };
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}
