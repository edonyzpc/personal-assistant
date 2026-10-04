import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { chatImageIdentity } from "../chat-image-identity";
import { stableJson } from "../vault-observation-evidence";
import { cloneInputLineage } from "../input-lineage";
import { additionalHistoricalActionStates, projectPaAgentActionHistory, projectPaAgentToolResult, summarizableReadOnlyResultIds } from "../pa-agent-action-history";
import type { projectPaAgentToolStatus } from '../pa-agent-action-history';
import { parseRunSourceSelection } from '../chat-source-scope';
import { extractCanonicalTurnMetadata, readChatHistoryTurnMetadata } from '../pa-agent-history';
import { finishContextSteps, prepareContextSteps } from './clone-utils';
import { cloneActionStateBinding, cloneActionStates, projectActionStates, projectActionSummaryFacts, type PaAgentActionSummaryFact } from '../pa-agent-result-facts';
import { cloneChatHostProvenance } from '../chat-provenance';
import type { PaAgentActionCall } from '../pa-agent-action-history';
import { encodeAdjacentRepeatsSteps } from './PaAgentContextTextEncoding';
import { stringifyContextSteps } from './PaAgentContextSerialization';

/** Request-only derived state. Never serialized to Chat history or Memory. */
export interface PaAgentHistorySummary {
    text: string;
    /** Exact immutable role/content snapshot of the summarized prefix. */
    sourceMessages: readonly ChatMessage[];
}

export interface PaAgentSummaryBindingSource {
    index: number;
    role: "user" | "assistant" | "tool";
    content: string;
    actionResult?: ReturnType<typeof projectPaAgentToolStatus>;
    /** Closed latest owner state, derived from an admitted Host message rather than its prose. */
    actionStates?: ReturnType<typeof projectActionStates>;
}

/** Immutable action evidence beside, rather than inside, free semantic sources. */
export interface PaAgentRetainedActionFacts {
    index: number;
    actionStates?: PaAgentActionSummaryFact[];
    actionResults?: Array<Omit<PaAgentActionCall['results'][number], 'text'> & {
        callId: string;
        toolName: string;
    }>;
    unresolvedCalls?: Array<{ callId: string; toolName: string; outcome: 'unknown' }>;
}

export function projectPaAgentRetainedActionFacts(messages: readonly ChatMessage[],
    indexes: readonly number[] = messages.map((_message, index) => index + 1)): PaAgentRetainedActionFacts[] {
    return finishContextSteps(projectPaAgentRetainedActionFactsSteps(messages, indexes));
}

export function* projectPaAgentRetainedActionFactsSteps(messages: readonly ChatMessage[],
    indexes: readonly number[] = messages.map((_message, index) => index + 1)):
    Generator<void, PaAgentRetainedActionFacts[], void> {
    const facts: PaAgentRetainedActionFacts[] = [];
    for (const [offset, message] of messages.entries()) {
        yield;
        if (message.role !== 'assistant') continue;
        // Initial canonical owner state is included here even if the ordinary
        // history serializer already represents its accepted/pending result.
        const owners = cloneActionStates(message.actionStates ?? message.canonicalTurn?.actionStates);
        const actionStates = projectActionSummaryFacts(owners);
        const actionResults: NonNullable<PaAgentRetainedActionFacts['actionResults']> = [];
        const unresolvedCalls: NonNullable<PaAgentRetainedActionFacts['unresolvedCalls']> = [];
        const readonlyIds = message.canonicalTurn ? summarizableReadOnlyResultIds(message.canonicalTurn.messages) : new Set<string>();
        for (const group of message.canonicalTurn ? projectPaAgentActionHistory(message.canonicalTurn.messages) : []) {
            for (const call of group.calls) {
                const hasOwnerReceipt = owners.some(owner => owner.origin.runId === message.canonicalTurn?.runId
                    && owner.origin.turnId === message.canonicalTurn?.turnId && owner.origin.assistantId === group.assistantId
                    && (owner.origin.callId === call.id || (!owner.origin.callId && group.calls.length === 1
                        && owner.origin.resultId === group.assistantId)));
                if (!call.results.length && !hasOwnerReceipt) {
                    unresolvedCalls.push({ callId: call.id, toolName: call.name, outcome: 'unknown' });
                }
                for (const result of call.results) {
                    yield;
                    if (readonlyIds.has(result.id)) continue;
                    actionResults.push({ id: result.id, outcome: result.outcome, isError: result.isError,
                        ...(result.executionState ? { executionState: result.executionState } : {}),
                        ...(result.preflightRejection ? { preflightRejection: result.preflightRejection } : {}),
                        ...(result.recovery ? { recovery: result.recovery } : {}),
                        ...(result.domainPhase ? { domainPhase: result.domainPhase } : {}),
                        ...(result.domainIdentity ? { domainIdentity: result.domainIdentity } : {}),
                        callId: call.id, toolName: call.name });
                }
            }
        }
        if (actionStates.length || actionResults.length || unresolvedCalls.length) facts.push({ index: indexes[offset]!,
            ...(actionStates.length ? { actionStates } : {}), ...(actionResults.length ? { actionResults } : {}),
            ...(unresolvedCalls.length ? { unresolvedCalls } : {}) });
    }
    return facts;
}

/** Verify the actual serialized source domain, not merely private binding metadata. */
export function* matchesPaAgentHistorySummaryPayloadSteps(messages: readonly { role: string; content: string }[],
    sources: readonly PaAgentSummaryBindingSource[], protectedIndexes: ReadonlySet<number>,
    retainedFacts: readonly PaAgentRetainedActionFacts[], previousSummary?: string): Generator<void, boolean, void> {
    if (messages.length !== 3 || messages[0].role !== 'system' || messages[1].role !== 'user'
        || messages[2].role !== 'user' || messages.some(message => typeof message.content !== 'string'
            || Object.keys(message).sort().join(',') !== 'content,role')) return false;
    let payload: unknown, referencePayload: unknown;
    try {
        payload = JSON.parse(messages[1].content);
        referencePayload = JSON.parse(messages[2].content);
    } catch { return false; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (!referencePayload || typeof referencePayload !== 'object' || Array.isArray(referencePayload)) return false;
    const body = payload as Record<string, unknown>;
    const reference = referencePayload as Record<string, unknown>;
    if (Object.keys(body).sort().join(',') !== 'phase,previousSummary,sourceKind,sourceMessages'
        || Object.keys(reference).sort().join(',') !== 'purpose,retainedActionFacts,sourceKind'
        || body.sourceKind !== 'chat_history' || body.phase !== 'rolling' || !Array.isArray(body.sourceMessages)
        || body.sourceMessages.length === 0 || reference.sourceKind !== 'retained_action_facts'
        || reference.purpose !== 'read_only_reference' || !Array.isArray(reference.retainedActionFacts)
        || (yield* stringifyContextSteps(reference.retainedActionFacts)) !== (yield* stringifyContextSteps(retainedFacts))
        || (yield* stringifyContextSteps(body.previousSummary)) !== (previousSummary ?? 'null')) return false;
    const byIndex = new Map(sources.map(source => [source.index, source]));
    for (const item of body.sourceMessages) {
        yield;
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const part = item as Record<string, unknown>;
        if (Object.keys(part).sort().join(',') !== 'content,end,index,role,start' || !Number.isInteger(part.index)
            || protectedIndexes.has(part.index as number)) return false;
        const source = byIndex.get(part.index as number);
        if (!source || part.role !== source.role || !Number.isInteger(part.start) || !Number.isInteger(part.end)
            || (part.start as number) < 0 || (part.end as number) < (part.start as number)
            || (part.end === part.start && source.content.length > 0)
            || (part.end as number) > source.content.length) return false;
        const content = source.content.slice(part.start as number, part.end as number);
        if (typeof part.content === 'string') {
            if (part.content !== content) return false;
        } else {
            const encoded = yield* encodeAdjacentRepeatsSteps(content);
            if (!encoded || (yield* stringifyContextSteps(encoded)) !== (yield* stringifyContextSteps(part.content))) return false;
        }
    }
    return true;
}

/** Called only on admitted history. Prose, including JSON-shaped prose, is never an owner receipt. */
export function projectPaAgentSummaryActionStates(message: ChatMessage): PaAgentSummaryBindingSource['actionStates'] {
    if (message.role !== 'assistant') return undefined;
    const states = projectActionStates(additionalHistoricalActionStates(message));
    return states.length ? states : undefined;
}

export type PaAgentToolSummarySource = Extract<PaAgentMessage, { role: "toolResult" }>;

export interface PaAgentToolSummary {
    text: string;
    /** Exact source snapshot, rechecked after Memory currentness refresh. */
    source: PaAgentToolSummarySource;
}

export interface PaAgentContextSummaries {
    history?: PaAgentHistorySummary;
    tools?: ReadonlyMap<string, PaAgentToolSummary>;
}

export interface PaAgentHistoryContextPlan {
    mode: "full" | "summarized";
    coveredMessages: number;
    summaryMaxChars: number;
}

export function isCurrentHistorySummary(summary: PaAgentHistorySummary, history: readonly ChatMessage[]): boolean {
    return finishContextSteps(isCurrentHistorySummarySteps(summary, history));
}

export async function isCurrentHistorySummaryAsync(summary: PaAgentHistorySummary, history: readonly ChatMessage[],
    signal?: AbortSignal): Promise<boolean> {
    return await prepareContextSteps(isCurrentHistorySummarySteps(summary, history), signal);
}

export function* isCurrentHistorySummarySteps(summary: PaAgentHistorySummary,
    history: readonly ChatMessage[]): Generator<void, boolean, void> {
    if (summary.sourceMessages.length === 0 || summary.sourceMessages.length > history.length) return false;
    for (const [index, message] of summary.sourceMessages.entries()) {
        yield;
        if (message.role !== history[index].role || message.content !== history[index].content
            || chatImageIdentity(message.images) !== chatImageIdentity(history[index].images)
            || historyEvidenceIdentity(message) !== historyEvidenceIdentity(history[index])) return false;
    }
    return true;
}

export function isCurrentToolSummary(summary: PaAgentToolSummary, message: PaAgentToolSummarySource): boolean {
    const source = summary.source;
    const current = message.content.includeInNextPrompt
        && source.id === message.id
        && source.toolCallId === message.toolCallId
        && source.toolName === message.toolName
        && source.isError === message.isError
        && stableJson(cloneInputLineage(source.inputLineage))
            === stableJson(cloneInputLineage(message.inputLineage))
        && source.content.promptText === message.content.promptText
        && JSON.stringify(source.content.sourceRecords ?? []) === JSON.stringify(message.content.sourceRecords ?? [])
        && stableJson(source.content.metadata?.vaultObservationEvidence)
            === stableJson(message.content.metadata?.vaultObservationEvidence);
    return current
        && stableJson(projectPaAgentToolResult(source)) === stableJson(projectPaAgentToolResult(message))
        && stableJson(source.content.metadata?.memoryManagementEvidence)
            === stableJson(message.content.metadata?.memoryManagementEvidence)
        && source.content.metadata?.memoryManagementEvidenceInvalid
            === message.content.metadata?.memoryManagementEvidenceInvalid;
}

function historyEvidenceIdentity(message: ChatMessage): string {
    // Read the same canonical-first, tool-result-inclusive source truth used by
    // history projection. A snapshot may contain normalized legacy metadata.
    let metadata: ChatMessage['memoryMetadata'];
    try { metadata = readChatHistoryTurnMetadata(message); }
    catch {
        // Legacy malformed receipts remain comparable as opaque source identity.
        // A valid canonical turn still outranks that legacy metadata.
        metadata = message.canonicalTurn
            ? extractCanonicalTurnMetadata(message.canonicalTurn) : message.memoryMetadata;
    }
    return stableJson({
        evidence: metadata?.vaultObservationEvidence,
        invalid: metadata?.vaultObservationEvidenceInvalid,
        version: metadata?.vaultObservationContractVersion,
        managementEvidence: metadata?.memoryManagementEvidence,
        managementEvidenceInvalid: metadata?.memoryManagementEvidenceInvalid,
        sourceRecords: metadata?.sourceRecords,
        reduction: metadata?.contextTrace?.reduction,
        runSourceSelection: parseRunSourceSelection(message.runSourceSelection
            ?? metadata?.runSourceSelection),
        inputLineage: cloneInputLineage(message.inputLineage ?? metadata?.inputLineage),
        actionHistory: message.canonicalTurn
            ? projectPaAgentActionHistory(message.canonicalTurn.messages) : [],
        semanticReadOnlyResults: message.canonicalTurn
            ? [...summarizableReadOnlyResultIds(message.canonicalTurn.messages)] : [],
        actionStates: cloneActionStates(message.actionStates ?? message.canonicalTurn?.actionStates),
        actionStateBinding: cloneActionStateBinding(message.actionStateBinding),
        hostProvenance: message.hostProvenance !== undefined ? cloneChatHostProvenance(message.hostProvenance) : undefined,
        runId: message.canonicalTurn?.runId,
        turnId: message.canonicalTurn?.turnId,
    });
}
