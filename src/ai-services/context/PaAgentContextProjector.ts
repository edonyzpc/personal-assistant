import type { ChatMessage, PaAgentMessage } from "../chat-types";
import {
    createPageletChatHandoffContext,
    type PageletChatHandoffContext,
} from "../pagelet-handoff";
import { escapeTaggedBoundary } from "../agent-utils";
import { sanitizeUserProfileMarkdownForPrompt } from "../memory-extraction/type-a-extractor";
import type { PaAgentContextCompactor } from "./PaAgentContextCompactor";
import { fitFullHistorySteps, formatHistoryMessagesSteps, formatSemanticHistorySummary,
    historySummaryPrefixLimitSteps, coldWritingHistoryReferencesSteps, historyRecord, coldWritingHistoryRecord,
    type ColdWritingVersion, type PaAgentColdWritingReferences, type PaAgentColdWritingProjection } from "./PaAgentHistoryContextPlan";
import { finishContextSteps } from './clone-utils';
import { isCurrentHistorySummarySteps, type PaAgentContextSummaries } from "./PaAgentContextSummaryTypes";
import type { GenerationInputBackgroundSources } from "../generation-input-snapshot";

export const MEMORY_CONTEXT_MAX_CHARS = 6_000;

export interface PaAgentInjectedContext {
    /** Host-only source receipt; never serialize into provider inputs or history. */
    isSourceCurrent?: () => boolean;
    /** Host-only identities for the exact Personal/Insights projection. */
    generationInputSources?: GenerationInputBackgroundSources;
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
    /** Current-turn feedback and source material, never a trusted protocol. */
    runtimeInstruction?: string;
    /** Only Harness-authored protocol templates; source text belongs in runtimeInstruction. */
    currentProtocol?: string;
    injectedContext?: PaAgentInjectedContext;
    maxHistoryChars: number;
    /** A zero limit omits the old-turn digest before reducing recent raw turns. */
    maxHistorySummaryChars?: number;
    summaries?: PaAgentContextSummaries;
    coldWritingVersions?: ReadonlyMap<string, ColdWritingVersion>;
    protectedWritingVersionIds?: ReadonlySet<string>;
}

export type PaAgentProjectedHistoryEntry =
    | { kind: 'message'; message: ChatMessage }
    | { kind: 'writing_reference'; projection: PaAgentColdWritingProjection }
    /** Already sandboxed admitted projection, including semantic summaries and lossless encodings. */
    | { kind: 'summary'; text: string; hasActionHistory: boolean };

export interface PaAgentProjectedHistory {
    /** The complete history exceeds a soft compaction target; no source was omitted. */
    historyBudgetLimited?: boolean;
    text: string;
    compactedCount: number;
    summaryChars: number;
    omittedCount: number;
    historyCompressed: boolean;
    /** Exact history messages represented by raw history or either summary form. Host-only. */
    sourceMessages: ChatMessage[];
    /** Sole provider-facing history view. sourceMessages is only for source binding and revalidation. */
    entries: PaAgentProjectedHistoryEntry[];
    /** Separate from summaryChars, which continues to measure the expendable legacy digest. */
    semanticSummaryChars?: number;
}

export class PaAgentContextProjector {
    constructor(_compactor?: PaAgentContextCompactor) {}

    projectUserInput(options: PaAgentProjectedInputOptions): { input: string; currentInput: string;
        currentContext: string; currentProtocol: string;
        history: PaAgentProjectedHistory } {
        return finishContextSteps(this.projectUserInputSteps(options));
    }

    *projectUserInputSteps(options: PaAgentProjectedInputOptions): Generator<void,
        { input: string; currentInput: string; currentContext: string; currentProtocol: string;
            history: PaAgentProjectedHistory }, void> {
        const coldReferences = yield* coldWritingHistoryReferencesSteps(options.chatHistory ?? [], options.coldWritingVersions);
        const history = yield* this.projectHistorySteps(
            options.chatHistory,
            options.maxHistoryChars,
            options.maxHistorySummaryChars,
            options.summaries,
            true,
            coldReferences,
            options.protectedWritingVersionIds,
        );
        const injected = formatInjectedContext(options.injectedContext);
        const runtimeInstruction = options.runtimeInstruction
            ? `Current run context and feedback:\n<runtime_instruction>\n${options.runtimeInstruction}\n</runtime_instruction>`
            : "";
        const currentContext = [
            options.hostContext ? `Host context:\n${options.hostContext}` : "",
            injected ? `Personal context:\n${injected}` : "",
            runtimeInstruction,
        ].filter(Boolean).join("\n\n");
        const currentInput = `User input:\n${options.prompt}`;
        const input = [history.text ? `Recent chat history:\n${history.text}` : "", currentContext, currentInput]
            .filter(Boolean).join("\n\n");
        return { input, currentInput, currentContext, currentProtocol: options.currentProtocol ?? "", history };
    }

    annotateOrigins(transcript: readonly PaAgentMessage[]): Array<{ id: string; origin: string }> {
        return transcript.map((message) => ({
            id: message.id,
            origin: message.role === "toolResult" ? "tool_result" : message.role,
        }));
    }

    private *projectHistorySteps(
        history: ChatMessage[] = [],
        maxHistoryChars: number,
        _maxHistorySummaryChars = 2400,
        summaries?: PaAgentContextSummaries,
        allowLossless = true,
        coldReferences?: PaAgentColdWritingReferences,
        protectedWritingVersionIds?: ReadonlySet<string>,
    ): Generator<void, PaAgentProjectedHistory, void> {
        const budget = Math.max(0, maxHistoryChars);
        const semantic = summaries?.history;
        const coveredMessages = semantic?.sourceMessages.length ?? 0;
        const prefixLimit = semantic?.text.trim()
            ? (yield* historySummaryPrefixLimitSteps(history, protectedWritingVersionIds)) : 0;
        if (semantic?.text.trim() && coveredMessages <= prefixLimit && history[coveredMessages]?.role === 'user'
            && (yield* isCurrentHistorySummarySteps(semantic, history))) {
            const summaryText = formatSemanticHistorySummary(semantic.text);
            const remaining = history.slice(coveredMessages);
            const tail = yield* fitFullHistorySteps(remaining, Math.max(0, budget - summaryText.length - 2),
                allowLossless, coldReferences);
            const entries: PaAgentProjectedHistoryEntry[] = [{ kind: 'summary', text: summaryText, hasActionHistory: true },
                ...(tail?.losslesslyEncoded ? [{ kind: 'summary' as const, text: tail.text, hasActionHistory: true }]
                    : remaining.map(message => {
                    const projection = coldReferences?.get(message);
                    return projection ? { kind: 'writing_reference' as const, projection }
                        : { kind: 'message' as const, message };
                }))];
            // Only the accepted source-bound prefix is replaced. Remaining turns
            // and the original source snapshots stay whole, even above the target.
            const text = renderProjectedHistoryEntries(entries);
            return withHistorySources({
                text, compactedCount: coveredMessages, summaryChars: 0,
                semanticSummaryChars: semantic.text.length,
                omittedCount: 0,
                historyCompressed: true,
                historyBudgetLimited: text.length > budget,
            }, history, entries);
        }
        const fullHistory = yield* fitFullHistorySteps(history, budget, allowLossless, coldReferences);
        if (fullHistory) {
            return withHistorySources({
                text: fullHistory.text,
                compactedCount: 0,
                summaryChars: 0,
                omittedCount: 0,
                historyCompressed: fullHistory.losslesslyEncoded || Boolean(coldReferences?.size),
            }, history, fullHistory.losslesslyEncoded ? undefined : history.map(message => {
                const projection = coldReferences?.get(message);
                return projection ? { kind: 'writing_reference' as const, projection }
                    : { kind: 'message' as const, message };
            }));
        }
        const text = yield* formatHistoryMessagesSteps(history, false, coldReferences);
        return withHistorySources({
            text, compactedCount: 0, summaryChars: 0, semanticSummaryChars: 0, omittedCount: 0,
            historyCompressed: Boolean(coldReferences?.size), historyBudgetLimited: text.length > budget,
        }, history, history.map(message => {
            const projection = coldReferences?.get(message);
            return projection ? { kind: 'writing_reference' as const, projection }
                : { kind: 'message' as const, message };
        }));
    }
}

function withHistorySources(
    history: Omit<PaAgentProjectedHistory, 'sourceMessages' | 'entries'>,
    sourceMessages: readonly ChatMessage[],
    entries?: PaAgentProjectedHistoryEntry[],
): PaAgentProjectedHistory {
    Object.defineProperty(history, 'sourceMessages', { value: [...sourceMessages] });
    Object.defineProperty(history, 'entries', { value: entries ?? (history.historyCompressed
        ? (history.text ? [{ kind: 'summary', text: history.text, hasActionHistory: sourceMessages.some(message =>
            message.canonicalTurn?.messages.some(part => part.role === 'assistant'
                && part.content.some(item => item.type === 'toolCall'))) }] : [])
        : sourceMessages.map(message => ({ kind: 'message', message }))) });
    history.text = renderProjectedHistoryEntries((history as PaAgentProjectedHistory).entries);
    return history as PaAgentProjectedHistory;
}

/** Compatibility rendering uses the same admitted entries as native message conversion. */
export function renderProjectedHistoryEntries(entries: readonly PaAgentProjectedHistoryEntry[]): string {
    const blocks: string[] = [];
    let records: Record<string, unknown>[] = [];
    const flush = () => {
        if (!records.length) return;
        blocks.push(`<chat_history context_only="true" format="json">\n${
            escapeTaggedBoundary(JSON.stringify(records, null, 2), 'chat_history')}\n</chat_history>`);
        records = [];
    };
    for (const entry of entries) {
        if (entry.kind === 'summary') { flush(); blocks.push(entry.text); }
        else records.push(entry.kind === 'message' ? historyRecord(entry.message) : coldWritingHistoryRecord(entry.projection));
    }
    flush();
    return blocks.join('\n\n');
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
