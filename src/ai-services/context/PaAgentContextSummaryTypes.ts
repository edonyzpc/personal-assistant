import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { chatImageIdentity } from "../chat-image-identity";
import { stableJson } from "../vault-observation-evidence";
import { cloneInputLineage } from "../input-lineage";
import { projectPaAgentActionHistory } from "../pa-agent-action-history";
import { parseRunSourceSelection } from '../chat-source-scope';
import { extractCanonicalTurnMetadata, readChatHistoryTurnMetadata } from '../pa-agent-history';

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
        && stableJson(cloneInputLineage(source.inputLineage))
            === stableJson(cloneInputLineage(message.inputLineage))
        && source.content.promptText === message.content.promptText
        && JSON.stringify(source.content.sourceRecords ?? []) === JSON.stringify(message.content.sourceRecords ?? [])
        && stableJson(source.content.metadata?.vaultObservationEvidence)
            === stableJson(message.content.metadata?.vaultObservationEvidence);
    return current
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
    });
}
