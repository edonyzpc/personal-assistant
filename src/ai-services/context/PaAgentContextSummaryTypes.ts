import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { chatImageIdentity } from "../chat-image-identity";
import { stableJson } from "../vault-observation-evidence";

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
            message.role === history[index].role && message.content === history[index].content
                && chatImageIdentity(message.images) === chatImageIdentity(history[index].images)
                && historyEvidenceIdentity(message) === historyEvidenceIdentity(history[index]));
}

export function isCurrentToolSummary(summary: PaAgentToolSummary, message: PaAgentToolSummarySource): boolean {
    const source = summary.source;
    const current = message.content.includeInNextPrompt
        && source.id === message.id
        && source.toolCallId === message.toolCallId
        && source.toolName === message.toolName
        && source.isError === message.isError
        && source.content.promptText === message.content.promptText
        && JSON.stringify(source.content.sourceRecords ?? []) === JSON.stringify(message.content.sourceRecords ?? [])
        && stableJson(source.content.metadata?.vaultObservationEvidence)
            === stableJson(message.content.metadata?.vaultObservationEvidence);
    return current
        && stableJson(source.content.metadata?.memoryManagementEvidence)
            === stableJson(message.content.metadata?.memoryManagementEvidence)
        && source.content.metadata?.memoryManagementEvidenceInvalid
            === message.content.metadata?.memoryManagementEvidenceInvalid;
    if (stableJson(source.content.metadata?.memoryManagementEvidence)
        !== stableJson(message.content.metadata?.memoryManagementEvidence)) return false;
    if (source.content.metadata?.memoryManagementEvidenceInvalid
        !== message.content.metadata?.memoryManagementEvidenceInvalid) return false;
    return true;
}

function historyEvidenceIdentity(message: ChatMessage): string {
    const metadata = message.memoryMetadata ?? message.canonicalTurn;
    return stableJson({
        evidence: metadata?.vaultObservationEvidence,
        invalid: metadata?.vaultObservationEvidenceInvalid,
        version: metadata?.vaultObservationContractVersion,
        managementEvidence: metadata?.memoryManagementEvidence,
        managementEvidenceInvalid: metadata?.memoryManagementEvidenceInvalid,
    });
}
