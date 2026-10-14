import type { CapabilityRegistry } from "../capability-registry";
import type { ChatToolResult } from "../chat-tool-types";
import type { PaAgentMessage, SourceRecord } from "../chat-types";
import { isAbortError, throwIfAborted } from "../chat-utils";
import type {
    PaAgentToolExecutor,
    PaAgentToolExecutionResult,
    ParsedBufferedToolCall,
} from "../pa-agent-types";
import { isCoreWriteToolName } from "../operations/input-validation";
import {
    collectActionStates,
    type PaAgentActionState,
} from "../pa-agent-result-facts";
import {
    checkpointTaskSourceRead,
} from "../task-source-read-guard";
import {
    cloneInputLineage,
    completeInputLineage,
    sourceRecordsInputLineage,
    unionInputLineages,
    type InputLineage,
} from "../input-lineage";
import type { CodemodeCallResourceLimits, CodemodeTool } from "../../third_party/pi-codemode/types";
import type { VmLauncher } from "../../third_party/pi-codemode/runtime/execution";
import { runIndependentCode } from "./browser-launcher";
import {
    EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS,
    type ExecuteObsidianCodeObservation,
    type ExecuteObsidianCodeRuntime,
} from "./obsidian-code-capability";

export const OBSIDIAN_CODE_CALL_RESOURCE_LIMITS: Readonly<CodemodeCallResourceLimits> = Object.freeze({
    maxPayloadBytes: 1_000_000,
    maxInflightBytes: 2_000_000,
    maxInflightCalls: 4,
});
const MAX_HOST_CALL_PAYLOAD_BYTES = OBSIDIAN_CODE_CALL_RESOURCE_LIMITS.maxPayloadBytes;
const MAX_QUEUED_HOST_CALL_BYTES = 2_000_000;
const MAX_RETAINED_OWNER_RESULT_BYTES = 2_000_000;
const EXCLUDED_TOOL_NAMES = new Set([
    "execute_code",
    "execute_obsidian_code",
    "load_tools",
    "load_skill",
]);

interface ChildCallRecord {
    readonly toolName: string;
    readonly toolCallId: string;
    readonly inputLineage: InputLineage;
    actionStates: PaAgentActionState[];
    finished: boolean;
    ownerPending: boolean;
    finishInputObservation?: (result: PaAgentToolExecutionResult) => InputLineage | undefined;
}

export interface ObsidianCodeRuntimeHost {
    readonly runId: string;
    readonly turnId: string;
    readonly turnIndex: number;
    readonly userInput: string;
    readonly parentToolCallId: string;
    readonly parentAssistantId: string;
    readonly parentInputLineage: InputLineage | undefined;
    readonly registry: CapabilityRegistry;
    readonly launcher?: VmLauncher;
    readonly scheduler?: HostCallScheduler;
    beginInputLineageObservation?(toolName: string): (result: PaAgentToolExecutionResult) => InputLineage | undefined;
    acceptInputLineage?(lineage: InputLineage): void;
    getExecutor(): PaAgentToolExecutor | undefined;
}

type ReleasePermit = () => void;
interface PermitControl {
    release: ReleasePermit;
    hold(): void;
}

export class HostCallScheduler {
    private readonly encoder = new TextEncoder();
    private readonly waiting: Array<{
        bytes: number;
        sequential: boolean;
        signal?: AbortSignal;
        detach: () => void;
        admit: () => void;
        reject: (error: Error) => void;
    }> = [];
    private runningCalls = 0;
    private runningBytes = 0;
    private runningSequential = false;
    private queuedBytes = 0;
    private retainedBytes = 0;

    constructor(readonly limits: Readonly<CodemodeCallResourceLimits> = OBSIDIAN_CODE_CALL_RESOURCE_LIMITS) {}

    measure(value: unknown): number {
        try {
            return this.encoder.encode(JSON.stringify(value) ?? "null").length;
        } catch {
            return this.limits.maxPayloadBytes + 1;
        }
    }

    async run<T>(
        bytes: number,
        signal: AbortSignal | undefined,
        task: (permit: PermitControl) => Promise<T>,
        sequential = false,
    ): Promise<T> {
        if (bytes > this.limits.maxPayloadBytes || bytes > this.limits.maxInflightBytes) {
            throw new Error("Host call input exceeds the composed-execution payload budget.");
        }
        await this.acquire(bytes, signal, sequential);
        let held = false;
        let released = false;
        const permit: PermitControl = {
            release: () => {
                if (released) return;
                released = true;
                this.release(bytes, sequential);
            },
            hold: () => {
                held = true;
            },
        };
        try {
            return await task(permit);
        } finally {
            if (!held) permit.release();
        }
    }

    private async acquire(bytes: number, signal: AbortSignal | undefined, sequential: boolean): Promise<void> {
        throwIfAborted(signal);
        if (this.waiting.length === 0 && this.canAdmit(bytes, sequential)) {
            this.runningCalls++;
            this.runningBytes += bytes;
            if (sequential) this.runningSequential = true;
            return;
        }
        if (this.queuedBytes + bytes > MAX_QUEUED_HOST_CALL_BYTES) {
            throw new Error("Composed-execution host-call queue is full.");
        }
        this.queuedBytes += bytes;
        let admitted = false;
        await new Promise<void>((resolve, reject) => {
            const abort = () => {
                this.rejectWaiting(entry, new Error("Composed execution was aborted."));
                this.drain();
            };
            const entry = { bytes, sequential, ...(signal ? { signal } : {}), detach: () => {
                signal?.removeEventListener("abort", abort);
            }, admit: () => {
                admitted = true;
                this.queuedBytes -= bytes;
                this.runningCalls++;
                this.runningBytes += bytes;
                if (sequential) this.runningSequential = true;
                resolve();
            }, reject };
            this.waiting.push(entry);
            signal?.addEventListener("abort", abort, { once: true });
            this.drain();
        });
        try {
            throwIfAborted(signal);
        } catch (error) {
            if (admitted) this.release(bytes, sequential);
            throw error;
        }
    }

    private canAdmit(bytes: number, sequential: boolean): boolean {
        return this.runningCalls < this.limits.maxInflightCalls
            && this.runningBytes + bytes <= this.limits.maxInflightBytes
            && (!sequential || !this.runningSequential);
    }

    private release(bytes: number, sequential: boolean): void {
        this.runningCalls--;
        this.runningBytes -= bytes;
        if (sequential) this.runningSequential = false;
        this.drain();
    }

    private drain(): void {
        while (this.waiting.length > 0) {
            // A queued sequential owner must not block independent reads.
            const index = this.waiting.findIndex(entry => entry.signal?.aborted
                || this.canAdmit(entry.bytes, entry.sequential));
            if (index < 0) return;
            const next = this.waiting[index];
            if (next.signal?.aborted) {
                this.rejectWaiting(next, new Error("Composed execution was aborted."));
                continue;
            }
            this.waiting.splice(index, 1);
            next.detach();
            next.admit();
        }
    }

    private rejectWaiting(entry: (typeof this.waiting)[number], error: Error): void {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) {
            this.waiting.splice(index, 1);
            this.queuedBytes -= entry.bytes;
        }
        entry.detach();
        entry.reject(error);
    }

    retainResult(bytes: number): boolean {
        if (bytes > MAX_RETAINED_OWNER_RESULT_BYTES
            || this.retainedBytes + bytes > MAX_RETAINED_OWNER_RESULT_BYTES) return false;
        this.retainedBytes += bytes;
        return true;
    }

    releaseResult(bytes: number): void {
        this.retainedBytes = Math.max(0, this.retainedBytes - bytes);
    }
}

const sharedHostCallSchedulers = new WeakMap<object, HostCallScheduler>();

/** A stopped request cannot reset permits still owned by the same live plugin host. */
export function getSharedHostCallScheduler(host: object): HostCallScheduler {
    let scheduler = sharedHostCallSchedulers.get(host);
    if (!scheduler) {
        scheduler = new HostCallScheduler();
        sharedHostCallSchedulers.set(host, scheduler);
    }
    return scheduler;
}

export function createExecuteObsidianCodeRuntime(host: ObsidianCodeRuntimeHost): ExecuteObsidianCodeRuntime {
    const scheduler = host.scheduler ?? new HostCallScheduler();
    let sequence = 0;
    let activePreview = false;
    let activeDeadlineAt: number | undefined;
    let deliveredLineage = cloneInputLineage(host.parentInputLineage)
        ?? completeInputLineage([{ kind: "user-text", messageId: host.parentToolCallId }]);
    const childRecords: ChildCallRecord[] = [];
    const sourceRecords: SourceRecord[] = [];
    const pendingOwners: Array<Promise<void>> = [];
    let pendingOwnerCount = 0;
    const sources = () => sourceRecords.flatMap(record => record.path
        ? [{ path: record.path, ...(record.observedRevision ? { observedRevision: record.observedRevision } : {}) }]
        : []);

    const boundCapabilities = host.registry.listCapabilities()
        .filter(capability => !EXCLUDED_TOOL_NAMES.has(capability.name)
            && host.registry.canExecute(capability.name).allowed);
    const bind = (capability: (typeof boundCapabilities)[number]): CodemodeTool => ({
            name: capability.name,
            description: capability.description,
            ...(capability.binaryResult ? { binaryResult: true } : {}),
            inputSchema: capability.toRegistryDefinition().inputSchema as unknown as CodemodeTool["inputSchema"],
            execute: async (rawInput, context) => {
                const bytes = scheduler.measure(rawInput);
                try {
                    return await scheduler.run(
                        bytes,
                        context.signal,
                        permit => executeChild(capability.name, rawInput, context.signal, permit),
                        host.getExecutor()?.getExecutionMode?.(capability.name) === "sequential",
                    );
                } catch (error) {
                    if (isAbortError(error, context.signal)) throw error;
                    return rejectedGuestResult(
                        "host_call_rejected",
                        error instanceof Error ? error.message : String(error),
                        "not_started",
                    );
                }
            },
        });
    const toolTable = boundCapabilities.filter(capability => !capability.sdkOnly).map(bind);
    const sdkGlobals = boundCapabilities.filter(capability => capability.sdkOnly).map(bind);

    return {
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            activePreview = input.mode === "preview";
            activeDeadlineAt = Math.min(context.outerToolDeadlineAt ?? Infinity,
                Date.now() + EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS);
            const inputSummary = `code:${input.code.length} chars; mode:${input.mode}`;
            const remainingMs = context.outerToolDeadlineAt === undefined
                ? EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS
                : context.outerToolDeadlineAt - Date.now();
            const timeoutMs = Math.min(EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS, remainingMs);
            if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
                return notStarted(inputSummary, "Composed execution deadline expired before Worker initialization.");
            }
            let result = await runIndependentCode({
                code: input.code,
                ...(context.signal ? { signal: context.signal } : {}),
                timeoutMs,
                tools: toolTable,
                ...(sdkGlobals.length ? { globals: sdkGlobals } : {}),
                callResourceLimits: scheduler.limits,
                ...(host.launcher ? { launcher: host.launcher } : {}),
            });
            const interrupted = context.signal?.aborted === true
                || !result.ok && (result.error.kind === "aborted" || result.error.kind === "timeout");
            if (!interrupted && pendingOwnerCount > 0) {
                const stop = await waitForOwners(pendingOwners, context.signal, activeDeadlineAt);
                if (stop) result = { ok: false, error: { kind: stop,
                    message: stop === "aborted" ? "Composed execution was aborted." : "Composed execution deadline expired." },
                    calls: result.calls, output: result.output };
            }
            for (const record of childRecords) refreshOwnerObservation(record);
            const actionStates = childRecords.flatMap(record => record.actionStates);
            const inputLineage = cloneInputLineage(deliveredLineage);
            if (result.ok) {
                const observation: ExecuteObsidianCodeObservation = {
                    value: result.value,
                    output: result.output,
                    calls: result.calls,
                    storeWrites: result.storeWrites,
                    mode: input.mode,
                };
                if (scheduler.measure(observation) > MAX_HOST_CALL_PAYLOAD_BYTES) {
                    return {
                        ok: false,
                        tool: "execute_obsidian_code",
                        inputSummary,
                        content: null,
                        sources: sources(),
                        sourceRecords,
                        actionStates,
                        inputLineage,
                        error: "The composed program result exceeds the composed-execution payload budget.",
                        executionState: pendingOwnerCount > 0 ? "acceptance_unknown" : "failed",
                    };
                }
                return {
                    ok: true,
                    tool: "execute_obsidian_code",
                    inputSummary,
                    content: observation,
                    sources: sources(),
                    sourceRecords,
                    actionStates,
                    inputLineage,
                    executionState: pendingOwnerCount > 0 ? "acceptance_unknown" : "succeeded",
                };
            }
            const prefix = result.error.name ? `${result.error.name}: ${result.error.message}` : result.error.message;
            return {
                ok: false,
                tool: "execute_obsidian_code",
                inputSummary,
                content: null,
                sources: sources(),
                sourceRecords,
                actionStates,
                inputLineage,
                error: result.error.stack ? `${prefix}\n${result.error.stack}` : prefix,
                executionState: pendingOwnerCount > 0 ? "acceptance_unknown" : "failed",
                ...(pendingOwnerCount > 0 ? { recovery: {
                    code: "operation_acceptance_unknown", allowedActions: ["query_operation", "needs_user"] as const,
                } } : {}),
            };
        },
    };

    async function executeChild(
        toolName: string,
        rawInput: unknown,
        signal: AbortSignal | undefined,
        permit: PermitControl,
    ): Promise<unknown> {
        const executor = host.getExecutor();
        const capability = host.registry.get(toolName);
        if (!executor || !capability) {
            return rejectedGuestResult("capability_unavailable", "The requested bound capability is unavailable.", "not_started");
        }
        throwIfAborted(signal);

        const effect = capability.retrySafety !== undefined
            ? capability.retrySafety === "side_effect"
            : capability.kind === "action"
                || !["read-only", "network-read"].includes(capability.permission);
        let childInput = rawInput;
        if (capability.supportsPreview && childInput && typeof childInput === "object" && !Array.isArray(childInput)) {
            const record = { ...(childInput as Record<string, unknown>) };
            if (record.mode === undefined) record.mode = activePreview ? "preview" : "apply";
            else if (activePreview) record.mode = "preview";
            childInput = record;
        } else if (activePreview && effect) {
            return rejectedGuestResult(
                "preview_unsupported",
                "This effect capability has no preview implementation; it was not executed.",
                "not_started",
            );
        }

        sequence += 1;
        const childCallId = `${host.parentToolCallId}:sdk:${sequence}`;
        const childCall: ParsedBufferedToolCall = {
            type: "toolCall",
            id: childCallId,
            index: host.turnIndex,
            name: toolName,
            input: childInput,
        };
        const childLineage = cloneInputLineage(deliveredLineage);
        if (!childLineage) throw new Error("Composed execution ancestry is no longer available.");
        const record: ChildCallRecord = {
            toolName,
            toolCallId: childCallId,
            inputLineage: childLineage,
            actionStates: [],
            finished: false,
            ownerPending: false,
            finishInputObservation: host.beginInputLineageObservation?.(toolName),
        };
        childRecords.push(record);

        const preflight = executor.preflightBatch?.({
            runId: host.runId,
            turnId: host.turnId,
            turnIndex: host.turnIndex,
            userInput: host.userInput,
            toolCalls: [childCall],
            inputLineage: childLineage,
        });
        if (preflight !== undefined && !("kind" in preflight)) return finishChild(record, preflight);
        const guard = preflight && "kind" in preflight ? preflight.taskSourceReadGuard : undefined;
        await checkpointTaskSourceRead(guard, signal);

        // Seal admitted ancestry before preparation can enter an effect owner.
        host.acceptInputLineage?.(childLineage);

        const prepared = await executor.prepareBatch?.({
            runId: host.runId,
            turnId: host.turnId,
            turnIndex: host.turnIndex,
            userInput: host.userInput,
            toolCalls: [childCall],
            signal: signal ?? new AbortController().signal,
            ...(guard ? { taskSourceReadGuard: guard } : {}),
            inputLineage: childLineage,
            hostParentBinding: {
                parentToolCallId: host.parentToolCallId,
                parentAssistantId: host.parentAssistantId,
            },
        });
        await checkpointTaskSourceRead(guard, signal);
        const preparedResult = prepared?.toolResults.get(childCallId);
        if (preparedResult) return finishChild(record, preparedResult);

        const timeout = executor.getTimeoutMs?.(toolName) ?? EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS;
        const parentRemaining = activeDeadlineAt === undefined
            ? Number.POSITIVE_INFINITY
            : activeDeadlineAt - Date.now();
        const childTimeoutMs = Math.max(0, Math.min(timeout, parentRemaining, EXECUTE_OBSIDIAN_CODE_TIMEOUT_MS));
        const controller = new AbortController();
        const abortParent = () => controller.abort();
        signal?.addEventListener("abort", abortParent, { once: true });
        if (signal?.aborted) controller.abort();
        if (activeDeadlineAt !== undefined && Date.now() >= activeDeadlineAt) {
            signal?.removeEventListener("abort", abortParent);
            return rejectedGuestResult(
                "deadline_exceeded",
                "The parent composed-execution deadline expired before the child owner could start.",
                "not_started",
            );
        }
        let ownerStarted = false;
        const ownerPromise = executor.execute({
            runId: host.runId,
            turnId: host.turnId,
            turnIndex: host.turnIndex,
            userInput: host.userInput,
            toolCall: childCall,
            signal: controller.signal,
            ...(guard ? { taskSourceReadGuard: guard } : {}),
            ...(activeDeadlineAt === undefined ? {} : { outerToolDeadlineAt: activeDeadlineAt }),
            inputLineage: childLineage,
        });
        ownerStarted = true;
        record.ownerPending = true;
        pendingOwnerCount++;
        pendingOwners.push(ownerPromise.then(() => undefined).catch(() => undefined).finally(() => {
            pendingOwnerCount--;
            record.ownerPending = false;
        }));
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<"timeout">(resolve => {
            timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                resolve("timeout");
            }, childTimeoutMs);
        });
        try {
            const raced = await Promise.race([ownerPromise, timeoutPromise]);
            if (raced === "timeout") {
                const observed = refreshOwnerObservation(record);
                const intentId = observed?.resultFact?.kind === "operations_result"
                    ? observed.resultFact.observation.intentId : undefined;
                const retrySafety = executor.getRetrySafety?.(toolName)
                    ?? (effect ? "side_effect" : "read_only");
                const timeoutResult: PaAgentToolExecutionResult = {
                    outcome: "recoverable_error",
                    executionState: retrySafety === "side_effect" ? "acceptance_unknown" : "failed",
                    promptText: `Tool ${toolName} timed out inside execute_obsidian_code.`,
                    includeInNextPrompt: true,
                    ...(retrySafety === "side_effect" ? {
                        recovery: {
                            code: "operation_acceptance_unknown",
                            allowedActions: ["query_operation", "needs_user"],
                            ...(intentId ? { operationId: intentId } : {}),
                        },
                    } : {}),
                    metadata: {
                        outcome: "recoverable_error",
                        reason: "composed_child_timeout",
                        failureReason: "timeout",
                        timeoutMs: childTimeoutMs,
                    },
                };
                transferPermitToOwner(ownerPromise, permit);
                ownerPromise.then(actualResult => finishChild(record, actualResult)).catch(() => undefined);
                return finishChild(record, timeoutResult);
            }
            return finishChild(record, raced);
        } catch (error) {
            ownerPromise.catch(() => undefined);
            if (ownerStarted) {
                const retrySafety = executor.getRetrySafety?.(toolName)
                    ?? (effect ? "side_effect" : "read_only");
                const unknownResult: PaAgentToolExecutionResult = {
                    outcome: "recoverable_error",
                    executionState: retrySafety === "side_effect" ? "acceptance_unknown" : "failed",
                    promptText: `Tool ${toolName} started, then the host executor threw after entering the owner boundary.`,
                    includeInNextPrompt: true,
                    ...(retrySafety === "side_effect" ? {
                        recovery: {
                            code: "operation_acceptance_unknown",
                            allowedActions: ["query_operation", "needs_user"],
                        },
                    } : {}),
                    metadata: {
                        outcome: "recoverable_error",
                        reason: "composed_child_owner_exception",
                    },
                };
                return finishChild(record, unknownResult);
            }
            throw error;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener("abort", abortParent);
            if (!timedOut) ownerPromise.catch(() => undefined);
        }
    }

    function transferPermitToOwner(
        owner: Promise<PaAgentToolExecutionResult>,
        permit: PermitControl,
    ): void {
        permit.hold();
        owner.catch(() => undefined).finally(() => permit.release());
    }

    function finishChild(record: ChildCallRecord, result: PaAgentToolExecutionResult): unknown {
        record.finished = true;
        // Owner facts survive a refused body; the guest's wire budget cannot erase a real operation.
        const resultLineage = record.finishInputObservation?.(result)
            ?? (result.sourceRecords?.length ? sourceRecordsInputLineage(result.sourceRecords) : undefined);
        if (resultLineage) {
            deliveredLineage = unionInputLineages(deliveredLineage, resultLineage);
            host.acceptInputLineage?.(resultLineage);
        }
        for (const sourceRecord of result.sourceRecords ?? []) {
            if (!sourceRecords.some(existing => JSON.stringify(existing) === JSON.stringify(sourceRecord))) {
                sourceRecords.push(sourceRecord);
            }
        }
        const states = childActionStates([record], host, result);
        if (states.length) record.actionStates = states;
        const fullResultBytes = scheduler.measure(result);
        if (!scheduler.retainResult(fullResultBytes)) {
            return rejectedGuestResult(
                "owner_result_budget_exceeded",
                "A host owner result exceeded the retained composed-execution resource budget.",
                result.executionState,
                result.recovery,
            );
        }
        try {
            const value = guestValue(result, host.registry.get(record.toolName)?.sdkOnly === true);
            if (scheduler.measure(value) > MAX_HOST_CALL_PAYLOAD_BYTES) {
                return rejectedGuestResult(
                    "output_budget_exceeded",
                    "The tool result exceeds the composed-execution payload budget.",
                    result.executionState,
                    result.recovery,
                );
            }
            return value;
        } finally {
            scheduler.releaseResult(fullResultBytes);
        }
    }

    function refreshOwnerObservation(record: ChildCallRecord): PaAgentToolExecutionResult | undefined {
        if (record.finished && !record.ownerPending) return undefined;
        const observed = host.getExecutor()?.getAttemptObservation?.({ runId: host.runId, turnId: host.turnId,
            toolCallId: record.toolCallId, toolName: record.toolName });
        if (observed) {
            const states = childActionStates([record], host, observed);
            if (states.length) record.actionStates = states;
        }
        return observed;
    }
}

async function waitForOwners(owners: readonly Promise<void>[], signal: AbortSignal | undefined,
    deadlineAt: number): Promise<"aborted" | "timeout" | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<"aborted" | "timeout">(resolve => {
        onAbort = () => resolve("aborted");
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        timer = setTimeout(() => resolve("timeout"), Math.max(0, deadlineAt - Date.now()));
    });
    try {
        return await Promise.race([Promise.allSettled(owners).then(() => undefined), interrupted]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
}

function guestValue(result: PaAgentToolExecutionResult, sdkOnly: boolean): unknown {
    try {
        const envelope = JSON.parse(result.promptText);
        const value = sdkOnly && envelope && typeof envelope === "object" && "observation" in envelope
            ? envelope.observation : envelope;
        if (sdkOnly && value && typeof value === "object" && typeof value.ok === "boolean") return value;
        if (result.outcome === "success" || result.outcome === "reused_result") return value;
        return {
            ...typeof value === "object" && value !== null ? value as Record<string, unknown> : { value },
            ok: false,
            execution: {
                ...(result.executionState ? { executionState: result.executionState } : {}),
                ...(result.recovery ? { recovery: result.recovery } : {}),
            },
            error: {
                code: String(result.metadata?.reason ?? result.outcome),
                message: result.promptText,
                ...(result.executionState ? { executionState: result.executionState } : {}),
                ...(result.recovery ? { recovery: result.recovery } : {}),
            },
        };
    } catch {
        return rejectedGuestResult(
            String(result.metadata?.reason ?? result.outcome),
            result.promptText,
            result.executionState,
            result.recovery,
        );
    }
}

function rejectedGuestResult(
    code: string,
    message: string,
    executionState: PaAgentToolExecutionResult["executionState"],
    recovery?: PaAgentToolExecutionResult["recovery"],
): { ok: false; error: { code: string; message: string; executionState?: string;
    recovery?: PaAgentToolExecutionResult["recovery"] } } {
    return { ok: false, error: { code, message, ...(executionState ? { executionState } : {}),
        ...(recovery ? { recovery } : {}) } };
}

function notStarted(inputSummary: string, message: string): ChatToolResult<ExecuteObsidianCodeObservation> {
    return {
        ok: false,
        tool: "execute_obsidian_code",
        inputSummary,
        content: null,
        sources: [],
        sourceRecords: [],
        error: message,
        executionState: "not_started",
    };
}

function childActionStates(
    records: readonly ChildCallRecord[],
    host: ObsidianCodeRuntimeHost,
    resultOverride?: PaAgentToolExecutionResult,
): PaAgentActionState[] {
    const states: PaAgentActionState[] = [];
    for (const record of records) {
        const result = resultOverride;
        if (!result) continue;
        const resultId = `${record.toolCallId}:result`;
        const assistant: PaAgentMessage = {
            role: "assistant",
            id: host.parentAssistantId,
            content: [{
                type: "toolCall",
                id: record.toolCallId,
                name: record.toolName,
                input: undefined,
                index: 0,
            }],
            timestamp: 0,
        };
        const toolResult: PaAgentMessage = {
            role: "toolResult",
            id: resultId,
            toolCallId: record.toolCallId,
            toolName: record.toolName,
            content: {
                promptText: result.promptText,
                includeInNextPrompt: result.includeInNextPrompt ?? true,
                sourceRecords: result.sourceRecords ?? [],
                ...(result.resultFact ? { resultFact: result.resultFact } : {}),
                metadata: {
                    ...result.metadata,
                    sdkOnly: host.registry.get(record.toolName)?.sdkOnly === true,
                    outcome: result.outcome,
                    tool: record.toolName,
                    toolCallId: record.toolCallId,
                    inputSummary: typeof result.metadata?.inputSummary === "string"
                        ? result.metadata.inputSummary
                        : "host child call",
                    ok: result.outcome === "success",
                    sourceRecordCount: result.sourceRecords?.length ?? 0,
                    contextUsedCount: 0,
                    ...(isCoreWriteToolName(record.toolName) && result.resultFact?.kind === "operations_result"
                        ? { operationsOwnerResult: true }
                        : {}),
                    ...(result.executionState ? { executionState: result.executionState } : {}),
                },
            },
            isError: result.outcome !== "success" && result.outcome !== "reused_result",
            inputLineage: record.inputLineage,
            timestamp: 0,
        };
        states.push(...collectActionStates({
            runId: host.runId,
            turnId: host.turnId,
            messages: [assistant, toolResult],
        }));
        const fact = result.resultFact;
        if (isCoreWriteToolName(record.toolName) && fact?.kind === "unknown" && fact.operationId) {
            const prepared = result.executionState === "not_started" && result.metadata?.ownerPrepared === true
                && result.metadata.state === "pending" && result.metadata.intentId === fact.operationId;
            states.push({
                schemaVersion: 1,
                owner: "operations",
                operationId: fact.operationId,
                phase: prepared ? "pending" : "unknown",
                origin: {
                    runId: host.runId,
                    turnId: host.turnId,
                    assistantId: host.parentAssistantId,
                    callId: record.toolCallId,
                    resultId,
                },
                revision: 0,
                inputLineage: record.inputLineage,
                receipt: { kind: prepared ? "operations-staged" : "operations-unknown", intentId: fact.operationId },
            });
        }
    }
    return states;
}
