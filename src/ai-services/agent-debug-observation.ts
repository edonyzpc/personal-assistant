import type { AgentEvent } from "./chat-types";
import {
    observeAgentDebug,
    type AgentDebugCallScope,
    type AgentDebugNodeStatus,
    type AgentDebugObservation,
    type AgentDebugRunRecorder,
    type AgentDebugUsage,
} from "./agent-debug-port";

let callSequence = 0;
const latestAttempts = new WeakMap<AgentDebugCallScope, string>();

export function bindAgentDebugAttempt(scope: AgentDebugCallScope, attemptId: string): void {
    latestAttempts.set(scope, attemptId);
}

export const agentDebugNow = (): number => typeof performance === "undefined" ? Date.now() : performance.now();

/** Inspection never invokes provider-defined getters or toJSON. */
function field(value: unknown, key: string): unknown {
    if (!value || typeof value !== "object") return undefined;
    try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

function token(value: unknown, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const candidate = field(value, key);
        if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) return candidate;
    }
    return undefined;
}

function responseText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    const length = field(content, "length");
    for (let index = 0; index < Math.min(typeof length === "number" ? length : 0, 256); index++) {
        const block = field(content, String(index));
        const text = field(block, "text");
        if (field(block, "type") === "text" && typeof text === "string") parts.push(text);
    }
    return parts.join("");
}

export function agentDebugError(error: unknown): AgentDebugObservation["error"] {
    const name = field(error, "name");
    const message = field(error, "message");
    const code = field(error, "code");
    return {
        name: typeof name === "string" ? name : "Error",
        ...(typeof message === "string" ? { message } : {}),
        ...(typeof code === "string" ? { code } : {}),
    };
}

export function agentDebugStatus(status: string): AgentDebugNodeStatus {
    switch (status) {
        case "completed": case "tool_results_ready": case "success": case "reused_result": return "completed";
        case "completed_with_warning": case "incomplete": return "partial";
        case "aborted": case "abort_timeout": return "cancelled";
        case "error": case "recoverable_error": case "schema_invalid": case "policy_rejected":
        case "budget_exceeded": return "failed";
        default: return "unknown";
    }
}

export function createAgentDebugCall(
    recorder: AgentDebugRunRecorder | undefined,
    input: Omit<AgentDebugCallScope, "recorder" | "callId"> & { callId?: string },
): AgentDebugCallScope | undefined {
    if (!recorder) return undefined;
    const scope = { ...input, recorder, callId: input.callId ?? `${recorder.captureId}:llm:${++callSequence}` };
    observeAgentDebug(recorder, () => ({ ...callIdentity(scope), phase: "prepare", status: "running" }));
    return scope;
}

function callIdentity(scope: AgentDebugCallScope): AgentDebugObservation {
    return {
        nodeId: scope.callId, parentId: scope.parentId, kind: "llm", phase: scope.purpose,
        purpose: scope.purpose,
        callId: scope.callId, turnId: scope.turnId, provider: scope.provider, model: scope.model,
        lineage: scope.lineage,
    };
}

export function observeAgentDebugCall(
    scope: AgentDebugCallScope | undefined,
    observation: Partial<AgentDebugObservation>,
): void {
    if (!scope) return;
    observeAgentDebug(scope.recorder, () => ({ ...callIdentity(scope), ...observation }));
    const attemptId = latestAttempts.get(scope);
    if (attemptId && (observation.phase === "consumer_end" || observation.phase === "error")) {
        observeAgentDebug(scope.recorder, () => ({
            nodeId: attemptId, parentId: scope.callId, kind: "attempt", phase: observation.phase!,
            callId: scope.callId, attemptId, turnId: scope.turnId, timing: observation.timing,
            status: observation.status === "cancelled" || observation.status === "completed" ? observation.status
                : observation.error ? "failed" : observation.missingReason ? "partial" : observation.status,
            error: observation.error, missingReason: observation.missingReason,
        }));
    }
}

/** LangChain usage_metadata represents per-call cumulative usage, not a billing invoice. */
export function readAgentDebugUsage(response: unknown): AgentDebugUsage | undefined {
    const metadata = field(response, "response_metadata");
    const candidates: Array<[string, unknown]> = [
        ["usage_metadata", field(response, "usage_metadata")], ["usage", field(response, "usage")],
        ["additional_kwargs.usage", field(field(response, "additional_kwargs"), "usage")],
        ["response_metadata.usage", field(metadata, "usage")],
        ["response_metadata.tokenUsage", field(metadata, "tokenUsage")],
        ["response_metadata.token_usage", field(metadata, "token_usage")],
        ["llm_output.tokenUsage", field(field(response, "llm_output"), "tokenUsage")],
    ];
    for (const [source, value] of candidates) {
        const inputTokens = token(value, ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"]);
        const outputTokens = token(value, ["output_tokens", "completion_tokens", "outputTokens", "completionTokens"]);
        const reportedTotal = token(value, ["total_tokens", "totalTokens"]);
        if (inputTokens === undefined && outputTokens === undefined && reportedTotal === undefined) continue;
        const bothSides = inputTokens !== undefined && outputTokens !== undefined;
        const inputDetails = field(value, "input_token_details") ?? field(value, "prompt_tokens_details");
        const outputDetails = field(value, "output_token_details") ?? field(value, "completion_tokens_details");
        return {
            inputTokens, outputTokens,
            totalTokens: reportedTotal ?? (bothSides ? inputTokens + outputTokens : undefined),
            cacheReadTokens: token(inputDetails, ["cache_read", "cached_tokens"]),
            reasoningTokens: token(outputDetails, ["reasoning", "reasoning_tokens"]),
            complete: reportedTotal !== undefined || bothSides,
            source, aggregation: "cumulative", updateKey: "provider-usage",
        };
    }
    return undefined;
}

export function observeAgentDebugResponse(
    scope: AgentDebugCallScope | undefined,
    response: unknown,
    mode: "delta" | "replace" = "replace",
    usageKey = "provider-usage",
): void {
    if (!scope) return;
    observeAgentDebug(scope.recorder, () => {
        const content = field(response, "content");
        const text = responseText(content);
        const reasoning = field(field(response, "additional_kwargs"), "reasoning_content");
        const usage = readAgentDebugUsage(response);
        return {
            ...callIdentity(scope), phase: "receiving", status: "running",
            ...(text ? { text, textMode: mode } : {}),
            ...(typeof reasoning === "string" && reasoning ? { reasoning } : {}),
            ...(Array.isArray(content) && (field(content, "length") as number) > 256 ? { missingReason: "output_block_limit" } : {}),
            usage: usage ? { ...usage, updateKey: usageKey } : undefined,
        };
    });
}

/** Lifecycle deltas/results are observed directly; cumulative message_end never backfills content. */
export function observeAgentDebugLifecycle(recorder: AgentDebugRunRecorder | undefined, event: AgentEvent): void {
    if (!recorder) return;
    if (event.type === "message_start" || event.type === "message_update"
        || (event.type === "message_end" && event.message.role !== "toolResult")) return;
    observeAgentDebug(recorder, () => {
        const root = recorder.captureId;
        const base = { runtimeRunId: event.runId, turnId: event.turnId, phase: event.type };
        if (event.type === "agent_start" || event.type === "agent_end") {
            return { ...base, nodeId: root, kind: "run", status: event.type === "agent_start" ? "running" : agentDebugStatus(event.status) };
        }
        if (event.type === "turn_start" || event.type === "turn_end") {
            return { ...base, nodeId: event.turnId, parentId: root, kind: "turn",
                status: event.type === "turn_start" ? "running" : agentDebugStatus(event.status) };
        }
        if (event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "tool_execution_update") {
            return { ...base, nodeId: `${event.turnId}:tool:${event.toolCallId}`, parentId: event.turnId,
                kind: "tool", toolCallId: event.toolCallId, toolName: event.toolName,
                lineage: { unknown: true },
                status: event.type === "tool_execution_end" ? agentDebugStatus(event.outcome) : "running",
                ...(event.type === "tool_execution_start" ? { toolInput: event.input } : {}),
                ...(event.type === "tool_execution_end" ? { outcome: event.outcome } : {}),
            };
        }
        if (event.type === "message_end" && event.message.role === "toolResult") {
            return { ...base, nodeId: `${event.turnId}:tool:${event.message.toolCallId}`, parentId: event.turnId,
                kind: "tool", toolCallId: event.message.toolCallId, toolName: event.message.toolName,
                toolOutput: event.message.content.promptText, lineage: { unknown: true },
            };
        }
        return { ...base, nodeId: root, kind: "phase" };
    });
    // Host diagnostics explain empty/finalization/recovery outcomes that need not throw.
    // Only known scalar fields enter the dedicated projection, never arbitrary metadata.
    try {
        if (!recorder.enabled() || (event.type !== "turn_end" && event.type !== "agent_end")) return;
        const diagnostics = field(event.metadata, "diagnostics");
        if (!Array.isArray(diagnostics)) return;
        diagnostics.slice(0, 32).forEach((diagnostic, index) => {
            const code = field(diagnostic, "type");
            const message = field(diagnostic, "message");
            if (typeof code !== "string") return;
            observeAgentDebug(recorder, () => ({
                nodeId: `${event.turnId}:diagnostic:${event.seq}:${index}`,
                parentId: event.type === "agent_end" ? recorder.captureId : event.turnId,
                kind: "phase", phase: "diagnostic", turnId: event.turnId, runtimeRunId: event.runId,
                outcome: code, lineage: { unknown: true },
                error: { code, ...(typeof message === "string" ? { message } : {}) },
            }));
        });
    } catch { /* Host diagnostics are not a new failure path. */ }
}

export function observeAgentDebugPhase(
    recorder: AgentDebugRunRecorder | undefined, phase: string, fields: Record<string, unknown>,
): void {
    if (!recorder) return;
    observeAgentDebug(recorder, () => {
        const turnId = typeof fields.turnId === "string" ? fields.turnId : undefined;
        const name = phase.replace(/:(?:start|end|error)$/, "");
        const nodeId = typeof fields.leaseId === "string" ? fields.leaseId : `${turnId ?? recorder.captureId}:phase:${name}`;
        return { nodeId, parentId: turnId ?? recorder.captureId,
            kind: "phase", phase, turnId,
            status: phase === "turn_lease:start" || phase === "chat_startup_lease:start" ? "queued"
                : phase.endsWith(":start") ? "running" : phase.endsWith(":error")
                    ? fields.status === "cancelled" || fields.status === "completed" ? fields.status : "failed"
                    : phase.endsWith(":end") || phase === "turn_lease_bound" ? "completed" : undefined,
            ...(typeof fields.action === "string" ? { outcome: `${fields.action}${typeof fields.reason === "string" ? `: ${fields.reason}` : ""}` }
                : typeof fields.reason === "string" ? { outcome: fields.reason } : {}),
        };
    });
}
