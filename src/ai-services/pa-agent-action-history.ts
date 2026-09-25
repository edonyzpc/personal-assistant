import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { PaAgentMessage, ToolExecutionOutcome } from "./chat-types";
import { escapeTaggedBoundary } from "./agent-utils";

type ToolResult = Extract<PaAgentMessage, { role: "toolResult" }>;

export interface PaAgentActionCall {
    id: string;
    name: string;
    input: unknown;
    /** A provider reused one id within this assistant message, so no result can be assigned safely. */
    ambiguousResultId?: boolean;
    results: Array<{ id: string; outcome: ToolExecutionOutcome | "unknown"; executionState?: string;
        isError: boolean; text: string }>;
}

export interface PaAgentActionGroup {
    assistantId: string;
    text: string;
    calls: PaAgentActionCall[];
}

const OUTCOMES = new Set<ToolExecutionOutcome>([
    "success", "reused_result", "recoverable_error", "schema_invalid", "policy_rejected",
    "budget_exceeded", "duplicate_skipped", "control_applied", "aborted", "abort_timeout",
]);
const EXECUTION_STATES = new Set(["not_started", "running", "succeeded", "failed",
    "partially_succeeded", "acceptance_unknown"]);

/** Only model-authored calls and approved result text cross this boundary. Host metadata stays private. */
export function projectPaAgentActionHistory(transcript: readonly PaAgentMessage[]): PaAgentActionGroup[] {
    const groups: PaAgentActionGroup[] = [];
    let openCalls = new Map<string, PaAgentActionCall | null>();
    for (const message of transcript) {
        if (message.role === "user") {
            openCalls = new Map();
            continue;
        }
        if (message.role === "assistant") {
            // A result belongs to the nearest preceding assistant action group,
            // never to an earlier group that happened to use the same provider id.
            openCalls = new Map();
            const calls = message.content.flatMap((part): PaAgentActionCall[] =>
                part.type === "toolCall" ? [{ id: part.id ?? "", name: part.name,
                    input: part.input, results: [] }] : []);
            if (!calls.length) continue;
            for (const call of calls) {
                if (!call.id) { call.ambiguousResultId = true; continue; }
                const prior = openCalls.get(call.id);
                if (prior) prior.ambiguousResultId = true;
                if (openCalls.has(call.id)) call.ambiguousResultId = true;
                openCalls.set(call.id, openCalls.has(call.id) ? null : call);
            }
            groups.push({ assistantId: message.id, text: message.content.flatMap(part =>
                part.type === "text" ? [part.text] : []).join(""), calls });
            continue;
        }
        const call = message.toolCallId ? openCalls.get(message.toolCallId) : undefined;
        if (call) call.results.push(projectResult(message));
    }
    return groups;
}

function projectResult(result: ToolResult): PaAgentActionCall["results"][number] {
    return {
        id: result.id,
        outcome: OUTCOMES.has(result.content.metadata?.outcome as ToolExecutionOutcome)
            ? result.content.metadata!.outcome as ToolExecutionOutcome : "unknown",
        ...(EXECUTION_STATES.has(String(result.content.metadata?.executionState))
            ? { executionState: String(result.content.metadata!.executionState) } : {}),
        isError: result.isError,
        text: result.content.includeInNextPrompt
            && result.content.metadata?.outcome !== "policy_rejected"
            && result.content.metadata?.outcome !== "duplicate_skipped"
            ? result.content.promptText : "",
    };
}

export function canProjectNativeActionHistory(groups: readonly PaAgentActionGroup[]): boolean {
    const ids = new Set<string>();
    for (const group of groups) for (const call of group.calls) {
        if (!call.id || ids.has(call.id) || !call.name || !nativeInput(call.input)) return false;
        ids.add(call.id);
    }
    return true;
}

function nativeInput(input: unknown): Record<string, unknown> | undefined {
    try {
        const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
        return value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown> : undefined;
    } catch { return undefined; }
}

function resultContent(call: PaAgentActionCall): string {
    if (call.ambiguousResultId) return escapeTaggedBoundary(JSON.stringify({
        status: "result_association_unknown", callId: call.id,
        detail: "A result cannot be assigned to this repeated call id; verify before replaying a possible side effect.",
    }), "action_history");
    if (!call.results.length) return escapeTaggedBoundary(JSON.stringify({
        status: "result_unknown", callId: call.id,
        detail: "No admitted observation is available; execution and side effects are unknown. Verify before replaying.",
    }), "action_history");
    return call.results.map(result => {
        const header = escapeTaggedBoundary(JSON.stringify({ resultId: result.id, callId: call.id,
            outcome: result.outcome,
            ...(result.executionState ? { executionState: result.executionState } : {}), isError: result.isError,
        }), "action_history");
        const safeText = escapeTaggedBoundary(escapeTaggedBoundary(result.text, "untrusted"), "action_history");
        return `${header}\n<untrusted source="tool:${call.name.replace(/["<>&]/g, "_")}">\n${safeText}\n</untrusted>`;
    }).join("\n\n");
}

/** Native and compatibility projections consume the same paired groups, never a second observation store. */
export function actionHistoryMessages(groups: readonly PaAgentActionGroup[], mode: "native" | "compat"): BaseMessage[] {
    if (mode === "native") {
        if (!canProjectNativeActionHistory(groups)) throw new Error("Action history cannot use native tool messages");
        return groups.flatMap(group => [
            new AIMessage({ content: group.text, tool_calls: group.calls.map(call => ({
                id: call.id, name: call.name, args: nativeInput(call.input)!,
            })) }),
            ...group.calls.map(call => new ToolMessage({ tool_call_id: call.id, name: call.name,
                content: resultContent(call) })),
        ]);
    }
    return groups.map(group => new HumanMessage({ content: [
        '<action_history context_only="true" grants_tool_authority="false" grants_write_authority="false">',
        escapeTaggedBoundary(JSON.stringify({ assistantId: group.assistantId, text: group.text }), "action_history"),
        ...group.calls.map(call => [
            `<action_call format="json">${escapeTaggedBoundary(escapeTaggedBoundary(JSON.stringify({
                id: call.id, name: call.name, input: call.input,
            }), "action_call"), "action_history")}</action_call>`,
            resultContent(call),
        ].join("\n")),
        "</action_history>",
    ].join("\n") }));
}
