import { toolConstraintsFromAgentControlSnapshot } from "../pa-agent-control-policy";
import { assertTaskSourceReadCurrent } from "../task-source-read-guard";
import { isAllowedHostToolCall } from "../pa-agent-host-tools";
import { operationsResultObservation } from "../operations-status-tool";
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
import { OPERATIONS_STAGED_MESSAGE } from "./operations-tool-provider";
import {
    getOperationsBlockedReason,
    EXECUTE_OPERATIONS_TOOL_NAME,
    type ExecuteCurrentOperationsIntentInput,
    type OperationsExecutionResult,
    type OperationsIntent,
    type OperationsMode,
    type StageOperationsIntentInput,
} from "./types";

export interface OperationsIntentStager {
    stageIntent(input: StageOperationsIntentInput, signal?: AbortSignal): Promise<OperationsIntent> | OperationsIntent;
    getBatchContextResult?(runId: string, turnId: string, toolCallIds: readonly string[]): {
        intent?: OperationsIntent; execution?: OperationsExecutionResult;
    };
    getCallContextResult?(runId: string, turnId: string, toolCallId: string): {
        intent?: OperationsIntent; execution?: OperationsExecutionResult;
    };
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

/** Prepare the whole phase first, then execute it once inside its first write call. */
export function createOperationsStagingToolExecutor(options: OperationsStagingToolExecutorOptions): PaAgentToolExecutor {
    // One runtime wrapper owns one currently dispatched phase. Reuse its
    // existing preparation result map so later calls can consume facts after
    // the first native write has invalidated the original read observation.
    let preparedPhase: { runId: string; turnId: string; toolResults: Map<string, PaAgentToolExecutionResult> } | undefined;
    return {
        preflightBatch: options.baseExecutor.preflightBatch?.bind(options.baseExecutor),
        getCanonicalToolCallKey: options.baseExecutor.getCanonicalToolCallKey?.bind(options.baseExecutor),
        getExecutionMode: name => isCoreWriteToolName(name) ? "sequential" : options.baseExecutor.getExecutionMode?.(name),
        getTimeoutMs: options.baseExecutor.getTimeoutMs?.bind(options.baseExecutor),
        getRetrySafety: name => isCoreWriteToolName(name) ? "side_effect" : options.baseExecutor.getRetrySafety?.(name),
        canReuseSuccessfulResult: options.baseExecutor.canReuseSuccessfulResult?.bind(options.baseExecutor),
        prepareBatch: async input => {
            const result = await prepareOperationsBatch(options, input);
            preparedPhase = { runId: input.runId, turnId: input.turnId, toolResults: result.toolResults as Map<string, PaAgentToolExecutionResult> };
            return result;
        },
        execute: async input => isCoreWriteToolName(input.toolCall.name)
            ? executePreparedBatch(options, input,
                preparedPhase?.runId === input.runId && preparedPhase.turnId === input.turnId ? preparedPhase.toolResults : undefined)
            : input.toolCall.name === EXECUTE_OPERATIONS_TOOL_NAME
                ? rejectedResult(input.toolCall.name, "operations_legacy_execution_retired")
                : options.baseExecutor.execute(input),
    };
}

async function executePreparedBatch(options: OperationsStagingToolExecutorOptions, input: PaAgentToolExecutionInput,
    preparedResults?: Map<string, PaAgentToolExecutionResult>): Promise<PaAgentToolExecutionResult> {
    const observed = options.controller.getCallContextResult?.(input.runId, input.turnId, input.toolCall.id);
    if (observed?.execution) return executionResult(observed.execution, input.toolCall.id);
    const intent = observed?.intent;
    if (!intent || intent.mode !== "apply") return rejectedResult(input.toolCall.name, "operations_batch_required");
    if (intent.state === "executing") return executionResult({ intentId: intent.id, state: "executing", operations: [] }, input.toolCall.id);
    if (!options.intentExecutor || !input.taskSourceReadGuard) return rejectedResult(input.toolCall.name, "operations_execution_unavailable");
    // Admission uses real registry/source facts. Model mode is not an approval receipt.
    for (const operation of intent.operations) {
        if (!isAllowedHostToolCall(operation.name, options.allowedToolNames,
            options.blockedToolNames)) return rejectedResult(operation.name, "tool_outside_user_requested_scope");
        const policy = options.registry.canExecute(operation.name);
        if (!policy.allowed) return rejectedResult(operation.name, "policy_rejected", policy.reason);
    }
    options.onToolRunning?.(input.toolCall.name, "Applying note changes...");
    try {
        const execution = await options.intentExecutor({ intentId: intent.id, runId: input.runId,
            signal: input.signal, taskSourceReadGuard: input.taskSourceReadGuard });
        for (const operation of execution.operations) preparedResults?.set(operation.toolCallId, executionResult(execution, operation.toolCallId));
        return executionResult(execution, input.toolCall.id);
    } catch (error) {
        if (!(error instanceof OperationsControllerError)) {
            return {
                outcome: "recoverable_error",
                promptText: `The result of Operations intent ${intent.id} is unknown. Query this original intent before another action; do not repeat the write.`,
                previewText: "The operation result is unknown.", includeInNextPrompt: true,
                metadata: { outcome: "error", reason: "operations_execution_unknown", intentId: intent.id },
                executionState: "acceptance_unknown", resultFact: { kind: "unknown", operationId: intent.id },
                recovery: { code: "operations_unknown", operationId: intent.id, allowedActions: ["query_operation", "wait"] },
            };
        }
        return {
            outcome: error.category === "boundary_denied" || error.category === "cancelled" || error.category === "expired"
                ? "policy_rejected" : "recoverable_error",
            promptText: `The Operations batch did not execute (${error.category}): ${safeError(error)}.`,
            previewText: "Note changes did not start.", includeInNextPrompt: true, executionState: "not_started",
            metadata: { outcome: "error", reason: "operations_execution_failed", intentId: intent.id,
                category: error.category, wrote: false },
        };
    }
}

function executionResult(execution: OperationsExecutionResult, toolCallId: string): PaAgentToolExecutionResult {
    const observation = operationsResultObservation(execution, toolCallId);
    const operation = execution.operations.find(result => result.toolCallId === toolCallId);
    const success = operation?.status === "succeeded" || operation?.status === "unchanged" || execution.state === "executing";
    return {
        outcome: success ? "success" : "recoverable_error",
        promptText: JSON.stringify(observation),
        previewText: operation?.status === "unchanged" ? "The note is already at the requested path."
            : `Note changes: ${operation?.status ?? execution.state}.`,
        includeInNextPrompt: true,
        resultFact: { kind: "operations_result", observation },
        metadata: { outcome: success ? "success" : "error", intentId: execution.intentId,
            state: execution.state, operationCount: observation.operations.length,
            undoAvailable: observation.undoAvailable, retrySafety: "side_effect" },
        executionState: operation?.status === "succeeded" || operation?.status === "unchanged" ? "succeeded"
            : execution.state === "executing" ? "running"
                : operation?.status === "partial" ? "partially_succeeded"
                    : operation?.status === "unknown" ? "acceptance_unknown" : "failed",
        ...(operation?.status === "partial" || operation?.status === "unknown" ? {
            recovery: { code: `operations_${operation.status}`, allowedActions: ["query_operation", "wait"], operationId: execution.intentId,
                completedParts: execution.operations.filter(result => result.status === "succeeded").map(result => result.operationId),
                remainingParts: execution.operations.filter(result => result.status !== "succeeded" && result.status !== "unchanged").map(result => result.operationId) },
        } : {}),
    };
}

async function prepareOperationsBatch(options: OperationsStagingToolExecutorOptions, input: PaAgentToolBatchPreparationInput): Promise<PaAgentToolBatchPreparationResult> {
    const toolResults = new Map<string, PaAgentToolExecutionResult>();
    const actionCalls = input.toolCalls.filter(call => options.registry.get(call.name)?.kind === "action" && isCoreWriteToolName(call.name));
    const rejectAll = (reason: string, detail?: string) => {
        for (const call of actionCalls) toolResults.set(call.id, rejectedResult(call.name, reason, detail));
        return { toolResults };
    };
    try { assertTaskSourceReadCurrent(input.taskSourceReadGuard); }
    catch { return rejectAll("task_source_scope_changed"); }
    const base = await options.baseExecutor.prepareBatch?.(input);
    for (const [id, result] of base?.toolResults ?? []) toolResults.set(id, result);
    if (!actionCalls.length) return { toolResults };
    try { assertTaskSourceReadCurrent(input.taskSourceReadGuard); }
    catch { return rejectAll("task_source_scope_changed"); }

    const observed = options.controller.getBatchContextResult?.(input.runId, input.turnId, actionCalls.map(call => call.id));
    if (observed?.execution) {
        for (const call of actionCalls) toolResults.set(call.id, executionResult(observed.execution, call.id));
        return { toolResults };
    }
    if (observed?.intent) {
        fillNonExecutingIntentResults(observed.intent, actionCalls.map(call => call.id), toolResults);
        return { toolResults };
    }
    const constraints = toolConstraintsFromAgentControlSnapshot(input.controlSnapshot);
    const operations: StageOperationsIntentInput["operations"][number][] = [];
    let mode: OperationsMode | undefined;
    let invalid = false;
    for (const call of actionCalls) {
        if (!isCoreWriteToolName(call.name)) continue;
        if (!isAllowedHostToolCall(call.name, constraints?.allowedToolNames ?? options.allowedToolNames,
            constraints?.blockedToolNames ?? options.blockedToolNames)) {
            invalid = true; toolResults.set(call.id, rejectedResult(call.name, "tool_outside_user_requested_scope")); continue;
        }
        const policy = options.registry.canExecute(call.name);
        if (!policy.allowed) { invalid = true; toolResults.set(call.id, rejectedResult(call.name, "policy_rejected", policy.reason)); continue; }
        const validated = options.registry.prepareAndValidate(call.name, call.input, { userInput: input.userInput });
        if (!validated.ok) {
            invalid = true;
            toolResults.set(call.id, { outcome: "schema_invalid", promptText: `Invalid ${call.name} arguments: ${safeError(validated.error)}. No write occurred.`,
                previewText: "Invalid note changes; nothing was written.", executionState: "not_started",
                metadata: { outcome: "schema_invalid", reason: "operations_schema_invalid", wrote: false } });
            continue;
        }
        const { mode: currentMode, ...domainInput } = validated.input as { mode: OperationsMode; [key: string]: unknown };
        if (mode && mode !== currentMode) return rejectAll("operations_mixed_modes", "Use one mode for the complete batch.");
        mode = currentMode;
        operations.push({ toolCallId: call.id, name: call.name, input: domainInput });
    }
    if (invalid) {
        for (const call of actionCalls) if (!toolResults.has(call.id)) toolResults.set(call.id, rejectedResult(call.name, "operations_batch_invalid"));
        return { toolResults };
    }
    for (const call of actionCalls) options.onToolRunning?.(call.name, "Preparing note changes...");
    try {
        const intent = await options.controller.stageIntent({ runId: input.runId, turnId: input.turnId,
            operations, mode, ...(input.taskSourceReadGuard ? { taskSourceReadGuard: input.taskSourceReadGuard } : {}) }, input.signal);
        for (const call of actionCalls) {
            const capability = options.registry.get(call.name);
            if (capability) options.registry.recordCapabilityEvent({ capabilityName: call.name, providerId: capability.providerId, status: "invoked", durationMs: 0 });
        }
        fillNonExecutingIntentResults(intent, actionCalls.map(call => call.id), toolResults);
    } catch (error) {
        for (const call of actionCalls) toolResults.set(call.id, {
            outcome: "recoverable_error", promptText: `The complete batch could not be prepared: ${safeError(error)}. No write occurred. Correct the arguments or explain the failure.`,
            previewText: "Changes could not be prepared; nothing was written.", executionState: "not_started",
            metadata: { outcome: "error", reason: "operations_preparation_failed", wrote: false },
        });
    }
    return { toolResults };
}

function fillNonExecutingIntentResults(intent: OperationsIntent, callIds: readonly string[],
    toolResults: Map<string, PaAgentToolExecutionResult>): void {
    const blocked = getOperationsBlockedReason(intent.operations);
    if (intent.mode !== "preview" && !blocked) return;
    const blockedResult: OperationsExecutionResult | undefined = blocked ? { intentId: intent.id, state: "failed",
        operations: intent.operations.map(operation => ({ operationId: operation.id, toolCallId: operation.toolCallId,
            name: operation.name, path: "", status: "failed", failureCategory: "boundary_denied", undoAvailable: false })) } : undefined;
    for (const callId of callIds) {
        const observation = blockedResult ? operationsResultObservation(blockedResult, callId) : undefined;
        toolResults.set(callId, { outcome: blocked ? "policy_rejected" : "success",
            promptText: observation ? JSON.stringify(observation) : OPERATIONS_STAGED_MESSAGE,
            previewText: blocked ? "Changes are blocked; nothing was written." : "Preview only; nothing was written.",
            executionState: "not_started",
            ...(observation ? { resultFact: { kind: "operations_result" as const, observation } } : {}),
            metadata: { outcome: blocked ? "policy_rejected" : "success", intentId: intent.id,
                operationCount: intent.operations.length, mode: intent.mode, wrote: false, ...(blocked ? { blockedReason: blocked } : {}) } });
    }
}

function rejectedResult(toolName: string, reason: string, detail?: string): PaAgentToolExecutionResult {
    return { outcome: "policy_rejected", promptText: `Tool ${toolName} was not executed (${reason})${detail ? `: ${detail}` : ""}. No write occurred.`,
        previewText: "Changes were skipped; nothing was written.", executionState: "not_started",
        metadata: { outcome: "policy_rejected", reason, wrote: false } };
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 240);
}
