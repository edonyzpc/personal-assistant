import type { ChatMessage, PaAgentMessage } from "../chat-types";

/** Request-only derived state. Never serialized to Chat history or Memory. */
export interface PaAgentHistorySummary {
    text: string;
    /** Exact immutable role/content snapshot of the summarized prefix. */
    sourceMessages: readonly ChatMessage[];
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
    return summary.sourceMessages.length > 0
        && summary.sourceMessages.length <= history.length
        && summary.sourceMessages.every((message, index) =>
            message.role === history[index].role && message.content === history[index].content);
}

export function isCurrentToolSummary(summary: PaAgentToolSummary, message: PaAgentToolSummarySource): boolean {
    const source = summary.source;
    return message.content.includeInNextPrompt
        && source.id === message.id
        && source.toolCallId === message.toolCallId
        && source.toolName === message.toolName
        && source.isError === message.isError
        && source.content.promptText === message.content.promptText
        && JSON.stringify(source.content.sourceRecords ?? []) === JSON.stringify(message.content.sourceRecords ?? []);
}
