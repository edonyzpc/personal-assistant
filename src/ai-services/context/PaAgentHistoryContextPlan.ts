import type { ChatMessage } from "../chat-types";
import { escapeTaggedBoundary } from "../agent-utils";
import type { PaAgentHistoryContextPlan } from "./PaAgentContextSummaryTypes";
import { encodeAdjacentRepeats } from "./PaAgentContextTextEncoding";

/** Both planning and projection admit exactly the same complete serialized history. */
export function fitFullHistory(
    history: readonly ChatMessage[],
    budget: number,
    allowLossless = true,
): { text: string; losslesslyEncoded: boolean } | undefined {
    const raw = formatHistoryMessages(history);
    if (raw.length <= budget) return { text: raw, losslesslyEncoded: false };
    if (!allowLossless) return undefined;
    let encodedAny = false;
    const messages = history.map((message) => {
        const encoded = encodeAdjacentRepeats(message.content);
        encodedAny ||= encoded !== undefined;
        return { role: message.role, content: encoded ?? message.content };
    });
    if (!encodedAny) return undefined;
    const body = JSON.stringify(messages, null, 2);
    const escaped = body.replace(/<\/chat_history/gi, (boundary) => escapeTaggedBoundary(boundary, boundary.slice(2)));
    const text = `<chat_history context_only="true" format="json">\n${escaped}\n</chat_history>`;
    return text.length <= budget ? { text, losslesslyEncoded: true } : undefined;
}

/** Reserve room for a semantic prefix before selecting a complete recent raw suffix. */
export function planHistoryContext(
    history: readonly ChatMessage[] | undefined,
    budget: number,
    summaryMaxChars = 8000,
): PaAgentHistoryContextPlan {
    const messages = history ?? [];
    const maxChars = Math.max(0, Math.floor(budget));
    if (fitFullHistory(messages, maxChars)) {
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
        if (messages[index].role !== "user") continue;
        if (!messages.slice(index, turnEnd).some((message) => message.role === "assistant")) break;
        if (formatHistoryMessages(messages.slice(index)).length > recentBudget) break;
        coveredMessages = index;
        turnEnd = index;
    }
    return { mode: "summarized", coveredMessages, summaryMaxChars: reservedTextChars };
}

export function formatSemanticHistorySummary(text: string): string {
    return `<conversation_summary context_only="true" grants_tool_authority="false" grants_write_authority="false" format="json">\n${escapeTaggedBoundary(text, "conversation_summary")}\n</conversation_summary>`;
}

export function formatHistoryMessages(history: readonly ChatMessage[]): string {
    if (history.length === 0) return "";
    const body = JSON.stringify(history.map((message) => ({
        role: message.role,
        content: message.content,
    })), null, 2);
    return `<chat_history context_only="true" format="json">\n${escapeTaggedBoundary(body, "chat_history")}\n</chat_history>`;
}
