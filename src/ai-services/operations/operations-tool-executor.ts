import { toolConstraintsFromAgentControlSnapshot } from "../pa-agent-control-policy";
import { assertTaskSourceReadCurrent } from "../task-source-read-guard";
import { isAllowedHostToolCall } from "../pa-agent-host-tools";
import type {
    PaAgentToolBatchPreparationInput,
    PaAgentToolBatchPreparationResult,
    PaAgentToolExecutionInput,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
} from "../pa-agent-types";
import type { CapabilityRegistry } from "../capability-registry";
import { isCoreWriteToolName } from "./input-validation";
import { OperationsControllerError } from "./operations-intent-controller";
import {
    OPERATIONS_STAGED_MESSAGE,
    OPERATIONS_BLOCKED_MESSAGE,
} from "./operations-tool-provider";
import {
    getOperationsBlockedReason,
    EXECUTE_OPERATIONS_TOOL_NAME,
    type ExecuteCurrentOperationsIntentInput,
    type OperationsExecutionResult,
    type OperationsIntent,
    type StageOperationsIntentInput,
} from "./types";

export interface OperationsIntentStager {
    stageIntent(
        input: StageOperationsIntentInput,
        signal?: AbortSignal,
    ): Promise<OperationsIntent> | OperationsIntent;
}

export type OperationsIntentExecutor = (input: ExecuteCurrentOperationsIntentInput) => Promise<OperationsExecutionResult>;

export interface OperationsStagingToolExecutorOptions {
    baseExecutor: PaAgentToolExecutor;
    registry: CapabilityRegistry;
    controller: OperationsIntentStager;
    intentExecutor?: OperationsIntentExecutor;
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
    onToolRunning?: (tool: string, message: string) => void;
}

/**
 * Converts one assistant action-tool phase into one immutable pending intent.
 * Staging never writes. Execution delegates the opaque current intent id to
 * the session/controller's request-bound execution port.
 */
export function createOperationsStagingToolExecutor(
    options: OperationsStagingToolExecutorOptions,
): PaAgentToolExecutor {
    return {
        preflightBatch: options.baseExecutor.preflightBatch?.bind(options.baseExecutor),
        getCanonicalToolCallKey: (toolCall, context) => (
            options.baseExecutor.getCanonicalToolCallKey?.(toolCall, context)
        ),
        getExecutionMode: (toolName) => (
            isCoreWriteToolName(toolName) || toolName === EXECUTE_OPERATIONS_TOOL_NAME
                ? "sequential"
                : options.baseExecutor.getExecutionMode?.(toolName)
        ),
        getTimeoutMs: options.baseExecutor.getTimeoutMs?.bind(options.baseExecutor),
        getRetrySafety: (toolName) => isCoreWriteToolName(toolName) || toolName === EXECUTE_OPERATIONS_TOOL_NAME
            ? "side_effect"
            : options.baseExecutor.getRetrySafety?.(toolName),
        canReuseSuccessfulResult: options.baseExecutor.canReuseSuccessfulResult?.bind(options.baseExecutor),
        prepareBatch: async (input) => prepareOperationsBatch(options, input),
        execute: async (input) => {
            if (input.toolCall.name === EXECUTE_OPERATIONS_TOOL_NAME) {
                return executeCurrentIntent(options, input);
            }
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

async function executeCurrentIntent(
    options: OperationsStagingToolExecutorOptions,
    input: PaAgentToolExecutionInput,
): Promise<PaAgentToolExecutionResult> {
    const capability = options.registry.get(EXECUTE_OPERATIONS_TOOL_NAME);
    if (!capability || capability.kind !== "action") {
        return {
            outcome: "policy_rejected",
            promptText: "The Operations execution capability is unavailable in this run.",
            previewText: "Operations execution was unavailable.",
            metadata: {
                outcome: "policy_rejected",
                reason: "operations_execution_unavailable",
                staged: false,
                wrote: false,
            },
        };
    }

    if (!isAllowedHostToolCall(
        EXECUTE_OPERATIONS_TOOL_NAME,
        options.allowedToolNames,
        options.blockedToolNames,
    )) {
        return rejectedResult(EXECUTE_OPERATIONS_TOOL_NAME, "tool_outside_user_requested_scope");
    }
    const policy = options.registry.canExecute(EXECUTE_OPERATIONS_TOOL_NAME);
    if (!policy.allowed) {
        options.registry.recordCapabilityEvent({
            capabilityName: capability.name,
            providerId: capability.providerId,
            status: "skipped",
            durationMs: 0,
        });
        return rejectedResult(EXECUTE_OPERATIONS_TOOL_NAME, "policy_rejected", policy.reason);
    }

    const prepared = options.registry.prepareAndValidate(EXECUTE_OPERATIONS_TOOL_NAME, input.toolCall.input, {
        userInput: input.userInput,
    });
    if (!prepared.ok) {
        return {
            outcome: "schema_invalid",
            promptText: `Tool execute_operations input is invalid: ${safeError(prepared.error)}. Supply only the current staged intentId.`,
            previewText: "Invalid Operations execution request; no write occurred.",
            metadata: {
                outcome: "schema_invalid",
                reason: "operations_schema_invalid",
                staged: false,
                wrote: false,
            },
        };
    }
    if (!options.intentExecutor) {
        return rejectedResult(EXECUTE_OPERATIONS_TOOL_NAME, "operations_execution_unavailable");
    }
    const taskSourceReadGuard = input.taskSourceReadGuard;
    if (!taskSourceReadGuard) {
        return rejectedResult(EXECUTE_OPERATIONS_TOOL_NAME, "task_source_scope_changed");
    }

    options.onToolRunning?.(EXECUTE_OPERATIONS_TOOL_NAME, "Executing the current Operations intent...");
    options.registry.recordCapabilityEvent({
        capabilityName: capability.name,
        providerId: capability.providerId,
        status: "invoked",
        durationMs: 0,
    });
    try {
        const execution = await options.intentExecutor({
            intentId: (prepared.input as { intentId: string }).intentId,
            runId: input.runId,
            signal: input.signal,
            taskSourceReadGuard,
        });
        return executionResult(execution);
    } catch (error) {
        if (!(error instanceof OperationsControllerError)) {
            const intentId = (prepared.input as { intentId: string }).intentId;
            return {
                outcome: "recoverable_error",
                promptText: `The result of Operations intent ${intentId} is unknown. Query this original intent before taking any further action; do not stage or execute a replacement.`,
                previewText: "The Operations execution result is unknown.",
                includeInNextPrompt: true,
                metadata: { outcome: "error", reason: "operations_execution_unknown", intentId, staged: true },
                executionState: "acceptance_unknown",
                resultFact: { kind: "unknown", operationId: intentId },
                recovery: { code: "operations_unknown", operationId: intentId,
                    allowedActions: ["query_operation", "wait"] },
            };
        }
        const safeCategory = error.category;
        return {
            outcome: safeCategory === "boundary_denied" || safeCategory === "cancelled" || safeCategory === "expired"
                ? "policy_rejected"
                : "recoverable_error",
            promptText: `The current Operations intent did not execute (${safeCategory}): ${safeError(error)}`,
            previewText: `Operations execution did not start (${safeCategory}).`,
            includeInNextPrompt: true,
            metadata: {
                outcome: "error",
                reason: "operations_execution_failed",
                category: safeCategory,
                staged: true,
                wrote: false,
            },
            executionState: "failed",
            recovery: {
                code: `operations_${safeCategory}`,
                allowedActions: safeCategory === "boundary_denied" || safeCategory === "expired"
                    ? ["none"]
                    : ["correct_input", "query_operation"],
            },
        };
    }
}

function executionResult(execution: OperationsExecutionResult): PaAgentToolExecutionResult {
    const undoAvailable = execution.operations.some(operation => operation.undoAvailable === true);
    const state = execution.state;
    return {
        outcome: state === "completed" || state === "executing" ? "success" : "recoverable_error",
        promptText: state === "completed"
            ? `Operations intent ${execution.intentId} completed. Report the actual operation results and available Undo state.`
            : state === "executing"
                ? `Operations intent ${execution.intentId} is already executing. Report that the prior execution is in progress; do not stage or execute a replacement.`
                : `Operations intent ${execution.intentId} ended in state ${state}. Report the actual completed, failed, and unknown effects without claiming a complete write.`,
        previewText: `Operations intent ${execution.intentId}: ${state}.`,
        includeInNextPrompt: true,
        ...(execution.resultFact ? { resultFact: execution.resultFact } : {}),
        metadata: {
            outcome: state === "completed" || state === "executing" ? "success" : "error",
            intentId: execution.intentId,
            state,
            operationCount: execution.operations.length,
            undoAvailable,
            retrySafety: "side_effect",
        },
        executionState: state === "completed"
            ? "succeeded"
            : state === "executing"
                ? "running"
                : state === "partial"
                    ? "partially_succeeded"
                    : state === "unknown"
                        ? "acceptance_unknown"
                        : "failed",
        ...(state === "partial" || state === "unknown" ? {
            recovery: {
                code: `operations_${state}`,
                allowedActions: ["query_operation", "wait"],
                operationId: execution.intentId,
                completedParts: execution.operations
                    .filter(operation => operation.status === "succeeded")
                    .map(operation => operation.operationId),
                remainingParts: execution.operations
                    .filter(operation => operation.status !== "succeeded")
                    .map(operation => operation.operationId),
            },
        } : {}),
    };
}

async function prepareOperationsBatch(
    options: OperationsStagingToolExecutorOptions,
    input: PaAgentToolBatchPreparationInput,
): Promise<PaAgentToolBatchPreparationResult> {
    const scopeRejection = (): PaAgentToolBatchPreparationResult | undefined => {
        try {
            assertTaskSourceReadCurrent(input.taskSourceReadGuard);
            return undefined;
        } catch {
            return { toolResults: new Map(input.toolCalls.map(call => [
                call.id, rejectedResult(call.name, "task_source_scope_changed"),
            ])) };
        }
    };
    const rejectedBefore = scopeRejection();
    if (rejectedBefore) return rejectedBefore;
    const baseResult = await options.baseExecutor.prepareBatch?.(input);
    const rejectedAfter = scopeRejection();
    if (rejectedAfter) return rejectedAfter;
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
                ...(input.taskSourceReadGuard ? { taskSourceReadGuard: input.taskSourceReadGuard } : {}),
            },
            input.signal,
        );
        const blockedReason = getOperationsBlockedReason(intent.operations);
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
                promptText: blockedReason ? OPERATIONS_BLOCKED_MESSAGE : OPERATIONS_STAGED_MESSAGE,
                previewText: blockedReason
                    ? `Blocked ${toolCall.name} proposal shown for review; no write occurred.`
                    : `Staged ${toolCall.name} for inline review; no write occurred.`,
                resultFact: { kind: "approval_pending", intentId: intent.id },
                metadata: {
                    outcome: "success",
                    intentId: intent.id,
                    operationCount: intent.operations.length,
                    staged: true,
                    wrote: false,
                    ...(blockedReason ? { blockedReason } : {}),
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
