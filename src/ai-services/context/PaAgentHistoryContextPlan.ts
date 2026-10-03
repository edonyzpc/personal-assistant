import type { ChatMessage } from "../chat-types";
import { escapeTaggedBoundary } from "../agent-utils";
import type { PaAgentHistoryContextPlan } from "./PaAgentContextSummaryTypes";
import { encodeAdjacentRepeatsSteps, encodeToolResultTextSteps } from "./PaAgentContextTextEncoding";
import { finishContextSteps } from './clone-utils';
import { stringifyContextSteps } from './PaAgentContextSerialization';
import { chatHistoryImageMetadata } from "../chat-image-identity";
import { projectPaAgentActionHistory, additionalHistoricalActionStates, canSummarizeReadOnlyActionHistory, summarizableReadOnlyResultIds } from "../pa-agent-action-history";
import { projectActionStates } from '../pa-agent-result-facts';
import { groupChatTurnsSteps } from './PaAgentContextCompactor';

export interface PaAgentProtectedHistoryLayout {
    turns: ChatMessage[][];
    evidenceTurns: ChatMessage[][];
    turnEnds: number[];
    protectedIndices: Set<number>;
    mandatoryIndices: Set<number>;
}

/** Planning and projection share the exact action evidence and latest full turn. */
export function* protectedHistoryLayoutSteps(history: readonly ChatMessage[]): Generator<void, PaAgentProtectedHistoryLayout, void> {
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
        ? turn.map(protectedEvidenceMessage) : turn);
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
    history: readonly ChatMessage[], budget: number, allowLossless = true,
): Generator<void, { text: string; losslesslyEncoded: boolean } | undefined, void> {
    const raw = yield* formatHistoryMessagesSteps(history);
    if (raw.length <= budget) return { text: raw, losslesslyEncoded: false };
    if (!allowLossless) return undefined;
    let encodedAny = false;
    const messages: Record<string, unknown>[] = [];
    for (const message of history) {
        yield;
        const encoded = yield* encodeAdjacentRepeatsSteps(message.content);
        encodedAny ||= encoded !== undefined;
        const record = historyRecord(message, encoded ?? message.content);
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
): PaAgentHistoryContextPlan {
    return finishContextSteps(planHistoryContextSteps(history, budget, summaryMaxChars));
}

export function* planHistoryContextSteps(
    history: readonly ChatMessage[] | undefined, budget: number, summaryMaxChars = 8000,
): Generator<void, PaAgentHistoryContextPlan, void> {
    const messages = history ?? [];
    const maxChars = Math.max(0, Math.floor(budget));
    if (yield* fitFullHistorySteps(messages, maxChars)) {
        return { mode: "full", coveredMessages: 0, summaryMaxChars: 0 };
    }
    const summaryWrapperChars = formatSemanticHistorySummary("").length;
    let reservedTextChars = Math.max(0, Math.min(
        Math.floor(summaryMaxChars),
        Math.floor(maxChars / 4),
        maxChars - summaryWrapperChars,
    ));
    const layout = yield* protectedHistoryLayoutSteps(messages);
    if (layout.protectedIndices.size > 0) {
        const mandatory = yield* selectHistoryTurnsSteps(layout.evidenceTurns, layout.mandatoryIndices);
        const mandatoryChars = Math.min(
            (yield* formatHistoryMessagesSteps(mandatory)).length,
            (yield* formatHistoryMessagesSteps(mandatory, true)).length,
        );
        reservedTextChars = Math.max(0, Math.min(reservedTextChars,
            maxChars - mandatoryChars - summaryWrapperChars - 2));
    }
    const recentBudget = Math.max(0, maxChars - summaryWrapperChars - reservedTextChars - 2);
    let coveredMessages = messages.length;
    if (layout.protectedIndices.size > 0) {
        // Older protected turns remain in the final payload even when covered
        // by the prefix. Count their union with each suffix, never twice.
        const retainedIndices = new Set(layout.mandatoryIndices);
        for (let index = layout.turns.length - 1; index >= 0; index--) {
            yield;
            const turn = layout.turns[index];
            if (turn[0]?.role !== 'user') continue;
            if (!turn.some(message => message.role === 'assistant')) break;
            retainedIndices.add(index);
            // Only the prefix actually covered by a summary may shed prose.
            const planningTurns = layout.turns.map((turn, turnIndex) => turnIndex < index
                ? layout.evidenceTurns[turnIndex] : turn);
            const candidate = yield* selectHistoryTurnsSteps(planningTurns, retainedIndices);
            if (!(yield* fitFullHistorySteps(candidate, recentBudget))) break;
            coveredMessages = index > 0 ? layout.turnEnds[index - 1] : 0;
        }
        return { mode: 'summarized', coveredMessages, summaryMaxChars: reservedTextChars };
    }
    // A suffix starts at a user and keeps complete turns, using the same
    // reversible serialization admitted by the final projector.
    let turnEnd = messages.length;
    for (let index = messages.length - 1; index >= 0; index--) {
        yield;
        if (messages[index].role !== "user") continue;
        if (!messages.slice(index, turnEnd).some((message) => message.role === "assistant")) break;
        if (!(yield* fitFullHistorySteps(messages.slice(index), recentBudget))) break;
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
    history: readonly ChatMessage[], lossless = false,
): Generator<void, string, void> {
    if (history.length === 0) return "";
    const records: Record<string, unknown>[] = [];
    for (const message of history) {
        yield;
        const content = lossless ? (yield* encodeAdjacentRepeatsSteps(message.content)) ?? message.content : message.content;
        const record = historyRecord(message, content);
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
    if (message.actionStates?.length || message.canonicalTurn?.actionStates?.length
        || (message.canonicalTurn?.messages.some(part => part.role === 'assistant'
            && part.content.some(item => item.type === 'toolCall'))
            && !canSummarizeReadOnlyActionHistory(message.canonicalTurn.messages))) {
        const readonlyIds = message.canonicalTurn ? summarizableReadOnlyResultIds(message.canonicalTurn.messages) : new Set<string>();
        const groups = message.canonicalTurn ? projectPaAgentActionHistory(message.canonicalTurn.messages) : [];
        const historicalAssistantText = groups.map(group => group.text).filter(text => text && text !== message.content);
        const actions = groups
            .map(group => ({ ...group, text: '', calls: group.calls.map(call => ({ ...call,
                results: call.results.filter(result => readonlyIds.has(result.id)) })).filter(call => call.results.length) }))
            .filter(group => group.calls.length);
        return actions.length || historicalAssistantText.length ? (yield* stringifyContextSteps({ text: message.content,
            ...(historicalAssistantText.length ? { historicalAssistantText } : {}),
            ...(actions.length ? { actionHistory: actions } : {}) }))! : message.content;
    }
    const record = historyRecord(message);
    if (!message.images?.length && !record.actionHistory && !(record.actionStates as unknown[] | undefined)?.length) {
        return message.content;
    }
    const facts = { ...record };
    delete facts.role;
    delete facts.content;
    return (yield* stringifyContextSteps({ text: record.content, ...facts,
        ...(message.images?.length ? { imageAvailability: 'reference_only_not_pixels' } : {}),
    }))!;
}
