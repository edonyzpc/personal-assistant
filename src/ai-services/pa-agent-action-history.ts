import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatMessage, PaAgentMessage, ToolExecutionOutcome } from "./chat-types";
import { escapeTaggedBoundary } from "./agent-utils";
import { cloneActionStates, projectPaAgentRecoveryControl, type PaAgentActionState } from './pa-agent-result-facts';

type ToolResult = Extract<PaAgentMessage, { role: "toolResult" }>;

/** Only paired, completed observations with Host execution classification may
 * move into a source-bound semantic summary. Legacy and unresolved calls stay exact. */
export function canSummarizeReadOnlyActionHistory(transcript: readonly PaAgentMessage[]): boolean {
    const groups = projectPaAgentActionHistory(transcript);
    const calls = groups.flatMap(group => group.calls);
    if (!calls.length) return false;
    const results = transcript.filter((message): message is ToolResult => message.role === 'toolResult');
    return results.length === calls.length && summarizableReadOnlyResultIds(transcript).size === calls.length;
}

export function summarizableReadOnlyResultIds(transcript: readonly PaAgentMessage[]): Set<string> {
    const results = transcript.filter((message): message is ToolResult => message.role === 'toolResult');
    const ids = new Set<string>();
    for (const call of projectPaAgentActionHistory(transcript).flatMap(group => group.calls)) {
        if (call.ambiguousResultId || call.results.length !== 1) continue;
        const paired = call.results[0];
        const matches = results.filter(message => message.id === paired.id && message.toolCallId === call.id);
        const result = matches.length === 1 && results.filter(message => message.id === paired.id).length === 1 ? matches[0] : undefined;
        if (result?.content.metadata?.retrySafety === 'read_only'
            && result.toolName === call.name
            && !result.isError && result.content.includeInNextPrompt
            && (paired.outcome === 'success' || paired.outcome === 'reused_result')
            && (!paired.executionState || paired.executionState === 'succeeded')
            && !result.content.resultFact) ids.add(paired.id);
    }
    return ids;
}

export interface PaAgentActionCall {
    id: string;
    name: string;
    input: unknown;
    /** A provider reused one id within this assistant message, so no result can be assigned safely. */
    ambiguousResultId?: boolean;
    results: Array<{ id: string; outcome: ToolExecutionOutcome | "unknown"; executionState?: string;
        recovery?: NonNullable<ReturnType<typeof projectPaAgentRecoveryControl>>;
        domainPhase?: 'accepted' | 'ready' | 'pending' | 'completed' | 'partial' | 'unknown';
        domainIdentity?: { operationId?: string; requestId?: string; receiptId?: string;
            intentId?: string; completedRefs?: string[]; remainingRefs?: string[] };
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
        if (call) call.results.push(projectPaAgentToolResult(message));
    }
    return groups;
}

/** Initial status is already represented by the original admitted result. Later snapshots
 * and rehydrated status-only fragments remain independent, context-only facts. */
export function additionalHistoricalActionStates(message: ChatMessage): PaAgentActionState[] {
    const groups = message.canonicalTurn ? projectPaAgentActionHistory(message.canonicalTurn.messages) : [];
    return cloneActionStates(message.actionStates ?? message.canonicalTurn?.actionStates).filter(state =>
        state.revision !== 0 || !groups.some(group => group.assistantId === state.origin.assistantId
            && group.calls.some(call => call.id === state.origin.callId
                && call.results.some(result => result.id === state.origin.resultId && result.domainPhase === state.phase))));
}

export function projectPaAgentToolResult(result: ToolResult): PaAgentActionCall["results"][number] {
    const domainIdentity = safeDomainIdentity(result);
    const recovery = projectPaAgentRecoveryControl(result.content.metadata?.recovery);
    const domainPhase = result.content.resultFact?.kind === 'accepted' ? 'accepted'
        : result.content.resultFact?.kind === 'artifact_ready' ? 'ready'
        : result.content.resultFact?.kind === 'approval_pending' ? 'pending'
        : result.content.resultFact?.kind === 'applied' ? 'completed'
        : result.content.resultFact?.kind === 'partial' ? 'partial'
        : result.content.resultFact?.kind === 'unknown' ? 'unknown' : undefined;
    return {
        id: result.id,
        outcome: OUTCOMES.has(result.content.metadata?.outcome as ToolExecutionOutcome)
            ? result.content.metadata!.outcome as ToolExecutionOutcome : "unknown",
        ...(EXECUTION_STATES.has(String(result.content.metadata?.executionState))
            ? { executionState: String(result.content.metadata!.executionState) } : {}),
        ...(recovery ? { recovery } : {}),
        isError: result.isError,
        ...(domainPhase ? { domainPhase } : {}),
        ...(domainIdentity ? { domainIdentity } : {}),
        text: result.content.includeInNextPrompt
            && result.content.metadata?.outcome !== "policy_rejected"
            && result.content.metadata?.outcome !== "duplicate_skipped"
            ? result.content.promptText : "",
    };
}

export function projectPaAgentToolStatus(result: ToolResult): Omit<PaAgentActionCall['results'][number], 'text'> {
    const status: Omit<PaAgentActionCall['results'][number], 'text'> & { text?: string } = projectPaAgentToolResult(result);
    delete status.text;
    return status;
}

/** This finite view carries no parameters, bodies, paths or permission receipts. */
function safeDomainIdentity(result: ToolResult): PaAgentActionCall['results'][number]['domainIdentity'] {
    const fact = result.content.resultFact;
    const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,256}$/.test(value);
    if (!fact) return undefined;
    if ((fact.kind === 'accepted' || fact.kind === 'unknown') && safeId(fact.operationId)) return { operationId: fact.operationId };
    if (fact.kind === 'approval_pending' && safeId(fact.intentId)) return { intentId: fact.intentId };
    if (fact.kind === 'artifact_ready' && safeId(fact.requestId) && safeId(fact.receiptId)) return { requestId: fact.requestId, receiptId: fact.receiptId };
    if (fact.kind === 'applied' && safeId(fact.receiptId)) return { receiptId: fact.receiptId };
    if (fact.kind === 'partial' && fact.completedRefs.length <= 100 && fact.remainingRefs.length <= 100
        && fact.completedRefs.every(safeId) && fact.remainingRefs.every(safeId)) {
        return { completedRefs: [...fact.completedRefs], remainingRefs: [...fact.remainingRefs] };
    }
    return undefined;
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

type ActionContextScope = "historical" | "current_run";

function resultContent(call: PaAgentActionCall, scope: ActionContextScope): string {
    if (call.ambiguousResultId) return escapeTaggedBoundary(JSON.stringify({
        contextScope: scope, status: "result_association_unknown", callId: call.id,
        detail: "A result cannot be assigned to this repeated call id; verify before replaying a possible side effect.",
    }), "action_history");
    if (!call.results.length) return escapeTaggedBoundary(JSON.stringify({
        contextScope: scope, status: "result_unknown", unknownScope: "tool_observation", callId: call.id,
        // Pure output calls normally have no tool result. Independent admitted
        // owner facts can still prove a phase; missing observations do not negate them.
        detail: "No admitted tool-result observation is available. Use admitted domain facts for known phases or effects; otherwise keep execution and effects unknown and verify before replaying.",
    }), "action_history");
    return call.results.map(result => {
        const header = escapeTaggedBoundary(JSON.stringify({ contextScope: scope, resultId: result.id, callId: call.id,
            outcome: result.outcome,
            ...(result.executionState ? { executionState: result.executionState } : {}), isError: result.isError,
            ...(result.recovery ? { recovery: result.recovery } : {}),
            ...(result.domainPhase ? { domainPhase: result.domainPhase } : {}),
            ...(result.domainIdentity ? { domainIdentity: result.domainIdentity } : {}),
        }), "action_history");
        const safeText = escapeTaggedBoundary(escapeTaggedBoundary(result.text, "untrusted"), "action_history");
        return `${header}\n<untrusted source="tool:${call.name.replace(/["<>&]/g, "_")}">\n${safeText}\n</untrusted>`;
    }).join("\n\n");
}

/** Native and compatibility projections consume the same paired groups, never a second observation store. */
export function actionHistoryMessages(groups: readonly PaAgentActionGroup[], mode: "native" | "compat",
    scope: ActionContextScope = "current_run"): BaseMessage[] {
    if (mode === "native") {
        if (!canProjectNativeActionHistory(groups)) throw new Error("Action history cannot use native tool messages");
        return groups.flatMap(group => [
            new AIMessage({ content: `<action_context scope="${scope}"/>${group.text ? `\n${group.text}` : ""}`, tool_calls: group.calls.map(call => ({
                id: call.id, name: call.name, args: nativeInput(call.input)!,
            })) }),
            ...group.calls.map(call => new ToolMessage({ tool_call_id: call.id, name: call.name,
                content: resultContent(call, scope) })),
        ]);
    }
    return groups.map(group => new HumanMessage({ content: [
        `<action_history scope="${scope}" context_only="true">`,
        escapeTaggedBoundary(JSON.stringify({ assistantId: group.assistantId, text: group.text }), "action_history"),
        ...group.calls.map(call => [
            `<action_call format="json">${escapeTaggedBoundary(escapeTaggedBoundary(JSON.stringify({
                id: call.id, name: call.name, input: call.input,
            }), "action_call"), "action_history")}</action_call>`,
            resultContent(call, scope),
        ].join("\n")),
        "</action_history>",
    ].join("\n") }));
}
