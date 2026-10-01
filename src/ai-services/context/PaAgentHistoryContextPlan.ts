import type { ChatMessage } from "../chat-types";
import { escapeTaggedBoundary } from "../agent-utils";
import type { PaAgentHistoryContextPlan } from "./PaAgentContextSummaryTypes";
import { encodeAdjacentRepeatsSteps } from "./PaAgentContextTextEncoding";
import { finishContextSteps } from './clone-utils';
import { stringifyContextSteps } from './PaAgentContextSerialization';
import { chatHistoryImageMetadata } from "../chat-image-identity";
import { projectPaAgentActionHistory } from "../pa-agent-action-history";

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
        messages.push(historyRecord(message, encoded ?? message.content));
    }
    if (!encodedAny) return undefined;
    const body = (yield* stringifyContextSteps(messages, 2))!;
    const escaped = yield* escapeHistorySteps(body, true);
    const text = `<chat_history context_only="true" format="json">\n${escaped}\n</chat_history>`;
    return text.length <= budget ? { text, losslesslyEncoded: true } : undefined;
}

/** Reserve room for a semantic prefix before selecting a complete recent raw suffix. */
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
    const reservedTextChars = Math.max(0, Math.min(
        Math.floor(summaryMaxChars),
        Math.floor(maxChars / 4),
        maxChars - summaryWrapperChars,
    ));
    const recentBudget = Math.max(0, maxChars - summaryWrapperChars - reservedTextChars - 2);
    let coveredMessages = messages.length;
    // A raw suffix begins at a user message and contains only complete turns.
    // A giant latest turn can instead be covered by the semantic prefix.
    let turnEnd = messages.length;
    for (let index = messages.length - 1; index >= 0; index--) {
        yield;
        if (messages[index].role !== "user") continue;
        if (!messages.slice(index, turnEnd).some((message) => message.role === "assistant")) break;
        if ((yield* formatHistoryMessagesSteps(messages.slice(index))).length > recentBudget) break;
        coveredMessages = index;
        turnEnd = index;
    }
    return { mode: "summarized", coveredMessages, summaryMaxChars: reservedTextChars };
}

export function formatSemanticHistorySummary(text: string): string {
    return `<conversation_summary context_only="true" grants_tool_authority="false" grants_write_authority="false" format="json">\n${escapeTaggedBoundary(text, "conversation_summary")}\n</conversation_summary>`;
}

export function formatHistoryMessages(history: readonly ChatMessage[], compactActionResults = false): string {
    return finishContextSteps(formatHistoryMessagesSteps(history, compactActionResults));
}

export function* formatHistoryMessagesSteps(
    history: readonly ChatMessage[], compactActionResults = false,
): Generator<void, string, void> {
    if (history.length === 0) return "";
    const records: Record<string, unknown>[] = [];
    for (const message of history) {
        yield;
        records.push(historyRecord(message, message.content, compactActionResults));
    }
    const body = (yield* stringifyContextSteps(records, 2))!;
    const escaped = yield* escapeHistorySteps(body);
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

function historyRecord(message: ChatMessage, content: unknown = message.content,
    compactActionResults = false): Record<string, unknown> {
    const actions = message.role === "assistant" && message.canonicalTurn
        ? projectPaAgentActionHistory(message.canonicalTurn.messages)
        : [];
    const projectedActions = compactActionResults ? actions.map(group => ({ ...group,
        calls: group.calls.map(call => ({ ...call, results: call.results.map(result => {
            const closed = (result.outcome === "success" || result.outcome === "reused_result")
                && (result.executionState === undefined || result.executionState === "succeeded");
            return closed ? { ...result,
                text: `[Earlier closed result compacted; originalChars=${result.text.length}; resultId=${result.id}.]`,
            } : result;
        }) })),
    })) : actions;
    return {
        role: message.role,
        content,
        ...chatHistoryImageMetadata(message),
        ...(projectedActions.length ? { actionHistory: projectedActions } : {}),
    };
}
