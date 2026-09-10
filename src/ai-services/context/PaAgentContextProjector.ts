import type { ChatMessage, PaAgentMessage } from "../chat-types";
import {
    createPageletChatHandoffContext,
    type PageletChatHandoffContext,
} from "../pagelet-handoff";
import { escapeTaggedBoundary } from "../agent-utils";
import { sanitizeUserProfileMarkdownForPrompt } from "../memory-extraction/type-a-extractor";
import { groupChatTurns, PaAgentContextCompactor } from "./PaAgentContextCompactor";
import { fitFullHistory, formatHistoryMessages, formatSemanticHistorySummary } from "./PaAgentHistoryContextPlan";
import { isCurrentHistorySummary, type PaAgentContextSummaries } from "./PaAgentContextSummaryTypes";

export const MEMORY_CONTEXT_MAX_CHARS = 6_000;

export interface PaAgentInjectedContext {
    /** Host-only source receipt; never serialize into provider inputs or history. */
    isSourceCurrent?: () => boolean;
    /** Host-rendered typed samples; admission counts their complete wrapper. */
    writingStyleContext?: string;
    /** Select exactly one Memory projection path for this prompt. */
    memoryContextMode?: "legacy" | "governed";
    userProfile?: string;
    vaultInsights?: string;
    /** Bounded output from the governed Memory selector; context only. */
    governedMemoryContext?: string;
    /** UI-only trace; never serialized into the model prompt. */
    governedMemoryTrace?: Array<{
        claimId: string;
        effect: "future_answers" | "collaboration_default";
        source?: "notes" | "interactions" | "settings" | "mixed";
        scope?: "current_vault" | "same_device";
        sourcePaths?: string[];
    }>;
    /** One-turn Pagelet evidence attachment; context only and never authority. */
    pageletHandoff?: PageletChatHandoffContext;
}

export interface PaAgentProjectedInputOptions {
    prompt: string;
    chatHistory?: ChatMessage[];
    hostContext?: string;
    runtimeInstruction?: string;
    injectedContext?: PaAgentInjectedContext;
    maxHistoryChars: number;
    /** A zero limit omits the old-turn digest before reducing recent raw turns. */
    maxHistorySummaryChars?: number;
    summaries?: PaAgentContextSummaries;
}

export interface PaAgentProjectedHistory {
    text: string;
    compactedCount: number;
    summaryChars: number;
    omittedCount: number;
    historyCompressed: boolean;
    /** Separate from summaryChars, which continues to measure the expendable legacy digest. */
    semanticSummaryChars?: number;
}

export class PaAgentContextProjector {
    private readonly compactor: PaAgentContextCompactor;

    constructor(compactor = new PaAgentContextCompactor()) {
        this.compactor = compactor;
    }

    projectUserInput(options: PaAgentProjectedInputOptions): { input: string; history: PaAgentProjectedHistory } {
        const history = this.projectHistory(
            options.chatHistory,
            options.maxHistoryChars,
            options.maxHistorySummaryChars,
            options.summaries,
        );
        const injected = formatInjectedContext(options.injectedContext);
        const runtimeInstruction = options.runtimeInstruction
            ? `\n\n<runtime_instruction>\n${options.runtimeInstruction}\n</runtime_instruction>`
            : "";
        const input = [
            history.text ? `Recent chat history:\n${history.text}` : "",
            options.hostContext ? `Host context:\n${options.hostContext}` : "",
            injected ? `Personal context:\n${injected}` : "",
            `User input:\n${options.prompt}${runtimeInstruction}`,
        ].filter(Boolean).join("\n\n");
        return { input, history };
    }

    annotateOrigins(transcript: readonly PaAgentMessage[]): Array<{ id: string; origin: string }> {
        return transcript.map((message) => ({
            id: message.id,
            origin: message.role === "toolResult" ? "tool_result" : message.role,
        }));
    }

    private projectHistory(
        history: ChatMessage[] = [],
        maxHistoryChars: number,
        maxHistorySummaryChars = 2400,
        summaries?: PaAgentContextSummaries,
        allowLossless = true,
    ): PaAgentProjectedHistory {
        const budget = Math.max(0, maxHistoryChars);
        const fullHistory = fitFullHistory(history, budget, allowLossless);
        if (fullHistory) {
            return {
                text: fullHistory.text,
                compactedCount: 0,
                summaryChars: 0,
                omittedCount: 0,
                historyCompressed: fullHistory.losslesslyEncoded,
            };
        }

        const semantic = summaries?.history;
        if (semantic?.text.trim() && isCurrentHistorySummary(semantic, history)) {
            const summaryText = formatSemanticHistorySummary(semantic.text);
            const coveredMessages = semantic.sourceMessages.length;
            const remaining = history.slice(coveredMessages);
            const tail = this.projectHistory(
                remaining,
                Math.max(0, budget - summaryText.length - (remaining.length > 0 ? 2 : 0)),
                maxHistorySummaryChars,
                undefined,
                false,
            );
            // A valid semantic prefix is atomic. If even the prefix cannot fit,
            // leave it intact for the final-request guard rather than slice JSON
            // or silently lose the goals/decisions that motivated summarization.
            return {
                text: [summaryText, tail.text].filter(Boolean).join("\n\n"),
                compactedCount: coveredMessages + tail.compactedCount,
                summaryChars: tail.summaryChars,
                semanticSummaryChars: semantic.text.length,
                omittedCount: tail.omittedCount,
                historyCompressed: true,
            };
        }

        // Keep complete recent exchanges as a contiguous suffix. Count the
        // actual JSON, escaping and sandbox wrapper rather than raw contents.
        const turns = groupChatTurns(history).filter((turn) =>
            turn.some((message) => message.role === "assistant"));
        let recentHistory: ChatMessage[] = [];
        let olderTurnCount = turns.length;
        for (let index = turns.length - 1; index >= 0; index--) {
            const candidate = [...turns[index], ...recentHistory];
            if (formatHistoryMessages(candidate).length > budget) break;
            recentHistory = candidate;
            olderTurnCount = index;
        }

        const olderHistory = turns.slice(0, olderTurnCount).flat();
        let summaryLimit = Math.min(Math.max(0, maxHistorySummaryChars), budget);
        let compacted = this.compactor.compactChatHistory(olderHistory, {
            recentTurns: 0,
            maxSummaryChars: summaryLimit,
        });
        let text = formatProjectedHistory(compacted.summary, recentHistory);
        // The digest is expendable before any chosen recent raw turn. Rebuild
        // whole lines to retain valid boundaries even when escaping expands it.
        while (compacted.summary && text.length > budget) {
            summaryLimit = Math.max(0, summaryLimit - (text.length - budget));
            compacted = this.compactor.compactChatHistory(olderHistory, {
                recentTurns: 0,
                maxSummaryChars: summaryLimit,
            });
            text = formatProjectedHistory(compacted.summary, recentHistory);
        }
        return {
            text,
            compactedCount: compacted.compactedCount,
            summaryChars: compacted.summary.length,
            omittedCount: history.length - recentHistory.length - compacted.compactedCount,
            historyCompressed: true,
        };
    }
}

function formatProjectedHistory(summary: string, history: ChatMessage[]): string {
    const summaryText = summary
        ? `<compaction_summary context_only="true">\n${escapeTaggedBoundary(summary, "compaction_summary")}\n</compaction_summary>`
        : "";
    const recentText = formatHistoryMessages(history);
    return [summaryText, recentText].filter(Boolean).join("\n\n");
}

export function formatInjectedContext(context: PaAgentInjectedContext | undefined): string {
    if (!context) return "";
    const blocks: string[] = [];
    const governedMemoryContext = context.governedMemoryContext?.trim();
    if (context.memoryContextMode === "governed" || (
        context.memoryContextMode === undefined && governedMemoryContext
    )) {
        // An explicitly governed prompt never falls back to legacy fields,
        // including when the governed selector intentionally returns empty.
        if (governedMemoryContext) {
            blocks.push(`<governed_memory_projection context_only="true" source="memory_governance" grants_tool_authority="false" grants_write_authority="false" grants_network_authority="false" grants_external_action_authority="false">\n${escapeTaggedBoundary(
                governedMemoryContext.slice(0, MEMORY_CONTEXT_MAX_CHARS),
                "governed_memory_projection",
            )}\n</governed_memory_projection>`);
        }
    } else {
        const userProfile = context.userProfile
            ? sanitizeUserProfileMarkdownForPrompt(context.userProfile)
            : "";
        if (userProfile) {
            blocks.push(`<user_profile context_only="true" source="memory_extraction">\n${escapeTaggedBoundary(userProfile, "user_profile")}\n</user_profile>`);
        }
        if (context.vaultInsights?.trim()) {
            blocks.push(`<vault_insights context_only="true" source="memory_extraction">\n${escapeTaggedBoundary(context.vaultInsights.trim(), "vault_insights")}\n</vault_insights>`);
        }
    }
    if (context.writingStyleContext) blocks.push(context.writingStyleContext);
    if (context.pageletHandoff) {
        const handoff = createPageletChatHandoffContext(context.pageletHandoff);
        const serialized = JSON.stringify(handoff, null, 2);
        blocks.push(`<pagelet_handoff context_only="true" source="pagelet_deep_discover" grants_tool_authority="false" grants_write_authority="false" grants_network_authority="false" grants_external_action_authority="false" format="json">\n${escapeTaggedBoundary(
            serialized,
            "pagelet_handoff",
        )}\n</pagelet_handoff>`);
    }
    return blocks.join("\n\n");
}
