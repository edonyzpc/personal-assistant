import type { ChatMessage } from "../chat-types";
import { escapeTaggedBoundary } from "../agent-utils";
import type { PaAgentHistoryContextPlan } from "./PaAgentContextSummaryTypes";
import { encodeAdjacentRepeatsSteps, encodeToolResultTextSteps } from "./PaAgentContextTextEncoding";
import { finishContextSteps } from './clone-utils';
import { stringifyContextSteps } from './PaAgentContextSerialization';
import { chatHistoryImageMetadata } from "../chat-image-identity";
import { projectPaAgentActionHistory, additionalHistoricalActionStates, canSummarizeReadOnlyActionHistory, summarizableReadOnlyResultIds } from "../pa-agent-action-history";
import { cloneActionStates, projectActionStates } from '../pa-agent-result-facts';
import { groupChatTurnsSteps } from './PaAgentContextCompactor';

export interface PaAgentProtectedHistoryLayout {
    turns: ChatMessage[][];
    evidenceTurns: ChatMessage[][];
    turnEnds: number[];
    protectedIndices: Set<number>;
    mandatoryIndices: Set<number>;
}

/** Runtime supplies only source-admitted, retrievable versions, excluding the selected parent. */
export interface ColdWritingVersion { textHash: string; text: string }
export interface PaAgentWritingReference {
    versionId: string;
    textHash: string;
    totalLength: number;
    bodyAvailability: 'read_writing_history';
    actionState: ReturnType<typeof projectActionStates>[number];
}
export interface PaAgentColdWritingProjection {
    message: ChatMessage;
    reference: PaAgentWritingReference;
}
export type PaAgentColdWritingReferences = ReadonlyMap<ChatMessage, PaAgentColdWritingProjection>;

/** Replace an independently bound final Writing group, never rewrite its original arguments. */
export function* coldWritingHistoryReferencesSteps(history: readonly ChatMessage[],
    versions?: ReadonlyMap<string, ColdWritingVersion>): Generator<void, PaAgentColdWritingReferences, void> {
    const references = new Map<ChatMessage, PaAgentColdWritingProjection>();
    if (!versions?.size) return references;
    const turns = yield* groupChatTurnsSteps(history);
    const complete = turns.filter(turn => turn[0]?.role === 'user' && turn.some(message => message.role === 'assistant'));
    const recent = new Set(complete.slice(-2).flat());
    for (const message of history) {
        yield;
        if (recent.has(message) || message.role !== 'assistant' || !message.canonicalTurn) continue;
        const canonical = message.canonicalTurn;
        const states = cloneActionStates(message.actionStates ?? canonical.actionStates);
        const groups = projectPaAgentActionHistory(canonical.messages);
        const group = groups[groups.length - 1];
        if (!group || group.calls.length !== 1 || group.calls[0].name !== 'present_writing') continue;
        const call = group.calls[0];
        if (!call.id || call.ambiguousResultId || call.results.length > 1) continue;
        const owners = states.filter(state => state.owner === 'writing' && state.origin.runId === canonical.runId
            && state.origin.turnId === canonical.turnId && state.origin.assistantId === group.assistantId
            && (!state.origin.callId || state.origin.callId === call.id)
            && (state.receipt.kind === 'writing-version' || state.receipt.kind === 'writing-save'
                || state.receipt.kind === 'writing-saves')
            && state.receipt.versionId === state.operationId
            && (!message.writingVersionId || state.operationId === message.writingVersionId));
        if (owners.length !== 1) continue;
        const owner = owners[0];
        const version = versions.get(owner.operationId);
        if (!version || !/^[a-f0-9]{64}$/.test(version.textHash)) continue;
        let input: unknown = call.input;
        if (typeof input === 'string') { try { input = JSON.parse(input); } catch { continue; } }
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || (input as Record<string, unknown>).body !== version.text) continue;
        if (call.results.length ? call.results[0].id !== owner.origin.resultId || call.results[0].isError
            || !['success', 'reused_result'].includes(call.results[0].outcome)
            : owner.origin.resultId !== group.assistantId) continue;
        if (canonical.messages.filter(part => part.id === group.assistantId).length !== 1) continue;
        const resultIds = new Set(call.results.map(result => result.id));
        if ([...resultIds].some(id => canonical.messages.filter(part => part.id === id).length !== 1
            || !canonical.messages.some(part => part.role === 'toolResult' && part.id === id && part.toolName === call.name))) continue;
        const remainingMessages = canonical.messages.filter(part => part.id !== group.assistantId && !resultIds.has(part.id));
        // Unrecognized duplicate renderings stay on the legacy path rather than silently lose text.
        if (remainingMessages.some(part => part.role === 'assistant'
            && part.content.some(item => item.type === 'text' && item.text.includes(version.text)))) continue;
        let content = message.content.endsWith(version.text)
            ? message.content.slice(0, -version.text.length) : message.content;
        const explanation = group.text.endsWith(version.text)
            ? group.text.slice(0, -version.text.length) : group.text;
        if (content.includes(version.text) || explanation.includes(version.text)) continue;
        if (explanation && !content.includes(explanation)) content = [content, explanation].filter(Boolean).join('\n\n');
        const retainedStates = states.filter(state => state !== owner);
        const projected: ChatMessage = { role: 'assistant', content,
            ...(message.images ? { images: message.images } : {}),
            ...(remainingMessages.length ? { canonicalTurn: { schemaVersion: canonical.schemaVersion,
                runId: canonical.runId, turnId: canonical.turnId, messages: remainingMessages } } : {}),
            ...(retainedStates.length ? { actionStates: retainedStates } : {}) };
        references.set(message, { message: projected, reference: { versionId: owner.operationId,
            textHash: version.textHash, totalLength: version.text.length, bodyAvailability: 'read_writing_history',
            actionState: projectActionStates([owner])[0] } });
    }
    return references;
}

/** Planning and projection share the exact action evidence and latest full turn. */
export function* protectedHistoryLayoutSteps(history: readonly ChatMessage[], references?: PaAgentColdWritingReferences): Generator<void, PaAgentProtectedHistoryLayout, void> {
    const firstUser = history.findIndex(message => message.role === 'user');
    const turns = firstUser < 0 ? (history.length ? [[...history]] : []) : [
        ...(firstUser > 0 ? [history.slice(0, firstUser)] : []),
        ...(yield* groupChatTurnsSteps(history.slice(firstUser))),
    ];
    let consumed = 0;
    const turnEnds: number[] = [], protectedIndices = new Set<number>();
    for (const [index, turn] of turns.entries()) {
        yield;
        turnEnds.push(consumed += turn.length);
        if (turn.some(message => message.actionStates?.length || message.canonicalTurn?.actionStates?.length
            || (message.canonicalTurn?.messages.some(part => part.role === 'assistant'
                && part.content.some(item => item.type === 'toolCall'))
                && !canSummarizeReadOnlyActionHistory(message.canonicalTurn.messages)))) protectedIndices.add(index);
    }
    const mandatoryIndices = new Set(protectedIndices);
    if (turns.length) mandatoryIndices.add(turns.length - 1);
    const evidenceTurns = turns.map((turn, index) => protectedIndices.has(index) && index !== turns.length - 1
        ? turn.map(message => references?.has(message) ? message : protectedEvidenceMessage(message)) : turn);
    return { turns, evidenceTurns, turnEnds, protectedIndices, mandatoryIndices };
}

function protectedEvidenceMessage(message: ChatMessage): ChatMessage {
    if (!message.canonicalTurn) return { ...message, content: '' };
    const readonlyIds = summarizableReadOnlyResultIds(message.canonicalTurn.messages);
    const messages = message.canonicalTurn.messages.map(part => {
        if (part.role === 'assistant') return { ...part, content: part.content.filter(item => item.type === 'toolCall') };
        if (part.role === 'toolResult' && readonlyIds.has(part.id)) {
            return { ...part, content: { ...part.content, promptText: '', includeInNextPrompt: false } };
        }
        return part;
    });
    return { ...message, content: '', canonicalTurn: { ...message.canonicalTurn, messages } };
}

/** Select each turn once, preserving original order and message identities. */
export function* selectHistoryTurnsSteps(turns: readonly ChatMessage[][], indices: ReadonlySet<number>): Generator<void, ChatMessage[], void> {
    const selected: ChatMessage[] = [];
    for (const [index, turn] of turns.entries()) {
        yield;
        if (indices.has(index)) selected.push(...turn);
    }
    return selected;
}

/** Protected facts have a separate reference lane; ordinary prose remains free. */
export function* protectedHistorySourceIndexesSteps(history: readonly ChatMessage[]): Generator<void, Set<number>, void> {
    for (let index = 0; index < history.length; index++) yield;
    return new Set();
}

/** Both planning and projection admit exactly the same complete serialized history. */
export function fitFullHistory(
    history: readonly ChatMessage[],
    budget: number,
    allowLossless = true,
): { text: string; losslesslyEncoded: boolean } | undefined {
    return finishContextSteps(fitFullHistorySteps(history, budget, allowLossless));
}

export function* fitFullHistorySteps(
    history: readonly ChatMessage[], budget: number, allowLossless = true, references?: PaAgentColdWritingReferences,
): Generator<void, { text: string; losslesslyEncoded: boolean } | undefined, void> {
    const raw = yield* formatHistoryMessagesSteps(history, false, references);
    if (raw.length <= budget) return { text: raw, losslesslyEncoded: false };
    if (!allowLossless) return undefined;
    let encodedAny = false;
    const messages: Record<string, unknown>[] = [];
    for (const message of history) {
        yield;
        const reference = references?.get(message);
        const encoded = reference ? undefined : yield* encodeAdjacentRepeatsSteps(message.content);
        encodedAny ||= encoded !== undefined;
        const record = reference ? coldWritingHistoryRecord(reference) : historyRecord(message, encoded ?? message.content);
        encodedAny = (yield* encodeHistoryActionResultsSteps(record)) || encodedAny;
        messages.push(record);
    }
    if (!encodedAny) return undefined;
    const body = (yield* stringifyContextSteps(messages, 2))!;
    const escaped = yield* escapeHistorySteps(body, true);
    const text = `<chat_history context_only="true" format="json">\n${escaped}\n</chat_history>`;
    return text.length <= budget ? { text, losslesslyEncoded: true } : undefined;
}

/** Reserve a semantic prefix beside the complete necessary history projection. */
export function planHistoryContext(
    history: readonly ChatMessage[] | undefined,
    budget: number,
    summaryMaxChars = 8000,
    coldWritingVersions?: ReadonlyMap<string, ColdWritingVersion>,
    protectedWritingVersionIds?: ReadonlySet<string>,
): PaAgentHistoryContextPlan {
    return finishContextSteps(planHistoryContextSteps(history, budget, summaryMaxChars, coldWritingVersions, protectedWritingVersionIds));
}

/** A semantic prefix ends between turns, before the latest exchange or selected Writing parent. */
export function* historySummaryPrefixLimitSteps(history: readonly ChatMessage[],
    protectedWritingVersionIds?: ReadonlySet<string>): Generator<void, number, void> {
    let turnStart = 0;
    let latestTurnStart = 0;
    let latestCompleteStart: number | undefined;
    let hasAssistant = false;
    let protectedStart = history.length;
    for (const [index, message] of history.entries()) {
        yield;
        if (message.role === 'user') {
            if (hasAssistant) latestCompleteStart = turnStart;
            turnStart = index; latestTurnStart = index; hasAssistant = false;
        } else if (message.role === 'assistant') hasAssistant = true;
        const ids = [message.writingVersionId,
            ...(message.actionStates ?? message.canonicalTurn?.actionStates ?? [])
                .filter(state => state.owner === 'writing').map(state => state.operationId)];
        if (ids.some(id => id && protectedWritingVersionIds?.has(id))) protectedStart = Math.min(protectedStart, turnStart);
    }
    if (hasAssistant) latestCompleteStart = turnStart;
    return Math.min(latestCompleteStart ?? latestTurnStart, protectedStart);
}

export function* planHistoryContextSteps(
    history: readonly ChatMessage[] | undefined, budget: number, summaryMaxChars = 8000,
    coldWritingVersions?: ReadonlyMap<string, ColdWritingVersion>,
    protectedWritingVersionIds?: ReadonlySet<string>,
): Generator<void, PaAgentHistoryContextPlan, void> {
    const messages = history ?? [];
    const references = yield* coldWritingHistoryReferencesSteps(messages, coldWritingVersions);
    const maxChars = Math.max(0, Math.floor(budget));
    if (yield* fitFullHistorySteps(messages, maxChars, true, references)) {
        return { mode: "full", coveredMessages: 0, summaryMaxChars: 0 };
    }
    const summaryWrapperChars = formatSemanticHistorySummary("").length;
    const reservedTextChars = Math.max(0, Math.min(
        Math.floor(summaryMaxChars),
        Math.floor(maxChars / 4),
        maxChars - summaryWrapperChars,
    ));
    const recentBudget = Math.max(0, maxChars - summaryWrapperChars - reservedTextChars - 2);
    const prefixLimit = yield* historySummaryPrefixLimitSteps(messages, protectedWritingVersionIds);
    let coveredMessages = prefixLimit;
    // A suffix starts at a user and keeps complete turns, using the same
    // reversible serialization admitted by the final projector.
    let turnEnd = prefixLimit;
    for (let index = prefixLimit - 1; index >= 0; index--) {
        yield;
        if (messages[index].role !== "user") continue;
        if (!messages.slice(index, turnEnd).some((message) => message.role === "assistant")) break;
        if (!(yield* fitFullHistorySteps(messages.slice(index), recentBudget, true, references))) break;
        coveredMessages = index;
        turnEnd = index;
    }
    return { mode: "summarized", coveredMessages, summaryMaxChars: reservedTextChars };
}

export function formatSemanticHistorySummary(text: string): string {
    return `<conversation_summary context_only="true" format="json">\n${escapeTaggedBoundary(text, "conversation_summary")}\n</conversation_summary>`;
}

export function formatHistoryMessages(history: readonly ChatMessage[], lossless = false): string {
    return finishContextSteps(formatHistoryMessagesSteps(history, lossless));
}

export function* formatHistoryMessagesSteps(
    history: readonly ChatMessage[], lossless = false, references?: PaAgentColdWritingReferences,
): Generator<void, string, void> {
    if (history.length === 0) return "";
    const records: Record<string, unknown>[] = [];
    for (const message of history) {
        yield;
        const reference = references?.get(message);
        const content = lossless && !reference ? (yield* encodeAdjacentRepeatsSteps(message.content)) ?? message.content : message.content;
        const record = reference ? coldWritingHistoryRecord(reference) : historyRecord(message, content);
        if (lossless) yield* encodeHistoryActionResultsSteps(record);
        records.push(record);
    }
    const body = (yield* stringifyContextSteps(records, 2))!;
    const escaped = yield* escapeHistorySteps(body, lossless);
    return `<chat_history context_only="true" format="json">\n${escaped}\n</chat_history>`;
}

function* escapeHistorySteps(body: string, preserveCase = false): Generator<void, string, void> {
    const chunks: string[] = [];
    for (let start = 0; start < body.length;) {
        yield;
        let end = Math.min(body.length, start + 16_384);
        // Keep a possible closing-tag prefix in this chunk rather than split its match.
        if (end < body.length) {
            const boundary = body.lastIndexOf('<', end - 1);
            if (boundary >= start && end - boundary < '</chat_history'.length) end = boundary > start ? boundary : end;
        }
        const chunk = body.slice(start, end);
        chunks.push(preserveCase
            ? chunk.replace(/<\/chat_history/gi, boundary => escapeTaggedBoundary(boundary, boundary.slice(2)))
            : escapeTaggedBoundary(chunk, 'chat_history'));
        start = end;
    }
    return chunks.join('');
}

export function historyRecord(message: ChatMessage, content: unknown = message.content): Record<string, unknown> {
    const actions = message.role === "assistant" && message.canonicalTurn
        ? projectPaAgentActionHistory(message.canonicalTurn.messages)
        : [];
    return {
        role: message.role,
        content,
        ...chatHistoryImageMetadata(message),
        ...(actions.length ? { actionHistory: actions } : {}),
        ...(message.actionStates ?? message.canonicalTurn?.actionStates ? {
            actionStates: projectActionStates(additionalHistoricalActionStates(message)),
        } : {}),
    };
}

export function coldWritingHistoryRecord(projection: PaAgentColdWritingProjection): Record<string, unknown> {
    return { ...historyRecord(projection.message), writingReference: projection.reference };
}

/** Source binding cannot establish semantic completeness. Only reversible
 * result encoding may replace a result body in the protected action view. */
function* encodeHistoryActionResultsSteps(record: Record<string, unknown>): Generator<void, boolean, void> {
    let encodedAny = false;
    const groups = record.actionHistory as ReturnType<typeof projectPaAgentActionHistory> | undefined;
    for (const group of groups ?? []) for (const call of group.calls) for (const result of call.results) {
        yield;
        const encoded = yield* encodeToolResultTextSteps(result.text);
        if (encoded) { result.text = encoded; encodedAny = true; }
    }
    return encodedAny;
}

/** Same admitted action view is used by summary serialization and dispatch revalidation. */
export function historySummaryContent(message: ChatMessage): string {
    return finishContextSteps(historySummaryContentSteps(message));
}

export function* historySummaryContentSteps(message: ChatMessage): Generator<void, string, void> {
    yield;
    const record = historyRecord(message);
    // Closed owner facts travel in retained_action_facts. Prose and original
    // call/result content are the free sources and can be split into chunks.
    delete record.actionStates;
    if (!message.images?.length && !record.actionHistory) {
        return message.content;
    }
    const facts = { ...record };
    delete facts.role;
    delete facts.content;
    return (yield* stringifyContextSteps({ text: record.content, ...facts,
        ...(message.images?.length ? { imageAvailability: 'reference_only_not_pixels' } : {}),
    }))!;
}
