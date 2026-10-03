import type { ChatMessage, PaAgentMessage } from "../chat-types";
import {
    createPageletChatHandoffContext,
    type PageletChatHandoffContext,
} from "../pagelet-handoff";
import { escapeTaggedBoundary } from "../agent-utils";
import { sanitizeUserProfileMarkdownForPrompt } from "../memory-extraction/type-a-extractor";
import { groupChatTurnsSteps, PaAgentContextCompactor } from "./PaAgentContextCompactor";
import { fitFullHistorySteps, formatHistoryMessagesSteps, formatSemanticHistorySummary,
    protectedHistoryLayoutSteps, selectHistoryTurnsSteps } from "./PaAgentHistoryContextPlan";
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
}

export interface PaAgentProjectedHistory {
    /** Protected facts exceeded the history lane; semantic preparation is required. */
    historyBudgetLimited?: boolean;
    text: string;
    compactedCount: number;
    summaryChars: number;
    omittedCount: number;
    historyCompressed: boolean;
    /** Exact history messages represented by raw history or either summary form. Host-only. */
    sourceMessages: ChatMessage[];
    /** Separate from summaryChars, which continues to measure the expendable legacy digest. */
    semanticSummaryChars?: number;
}

export class PaAgentContextProjector {
    private readonly compactor: PaAgentContextCompactor;

    constructor(compactor = new PaAgentContextCompactor()) {
        this.compactor = compactor;
    }

    projectUserInput(options: PaAgentProjectedInputOptions): { input: string; currentInput: string;
        currentContext: string; currentProtocol: string;
        history: PaAgentProjectedHistory } {
        return finishContextSteps(this.projectUserInputSteps(options));
    }

    *projectUserInputSteps(options: PaAgentProjectedInputOptions): Generator<void,
        { input: string; currentInput: string; currentContext: string; currentProtocol: string;
            history: PaAgentProjectedHistory }, void> {
        const history = yield* this.projectHistorySteps(
            options.chatHistory,
            options.maxHistoryChars,
            options.maxHistorySummaryChars,
            options.summaries,
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
        maxHistorySummaryChars = 2400,
        summaries?: PaAgentContextSummaries,
        allowLossless = true,
    ): Generator<void, PaAgentProjectedHistory, void> {
        const budget = Math.max(0, maxHistoryChars);
        const fullHistory = yield* fitFullHistorySteps(history, budget, allowLossless);
        if (fullHistory) {
            return withHistorySources({
                text: fullHistory.text,
                compactedCount: 0,
                summaryChars: 0,
                omittedCount: 0,
                historyCompressed: fullHistory.losslesslyEncoded,
            }, history);
        }

        // A persisted action's parameters and call/result relationship are
        // protected history. Source-bound summaries may replace ordinary prose
        // while action evidence stays in its original chronological place.
        // If the protected set itself is too large, final admission fails.
        const protectedHistory = yield* protectedHistoryLayoutSteps(history);
        if (protectedHistory.protectedIndices.size > 0 || history.some(message => message.canonicalTurn?.messages.some(part =>
            part.role === 'assistant' && part.content.some(item => item.type === 'toolCall')))) {
            const semantic = summaries?.history?.text.trim()
                && (yield* isCurrentHistorySummarySteps(summaries.history, history)) ? summaries.history : undefined;
            const summaryText = semantic ? formatSemanticHistorySummary(semantic.text) : "";
            const summarizedPrefixCount = semantic?.sourceMessages.length ?? 0;
            const { turns, turnEnds } = protectedHistory;
            const projectedTurns = turns.map((turn, index) => turnEnds[index] <= summarizedPrefixCount
                ? protectedHistory.evidenceTurns[index] : turn);
            const retainedIndices = new Set(protectedHistory.mandatoryIndices);
            // Completed reads may be replaced only by an accepted source-bound
            // summary, never by the fallback line digest or a missing prefix.
            for (const [index, turn] of turns.entries()) if (turnEnds[index] > summarizedPrefixCount
                && turn.some(message => message.canonicalTurn?.messages.some(part => part.role === 'assistant'
                    && part.content.some(item => item.type === 'toolCall')))) retainedIndices.add(index);
            // The newest correction must not disappear to make old protected
            // action history fit. An insufficient lane fails admission instead.
            const formatRetained = function* (lossless: boolean): Generator<void, string, void> {
                const retained = yield* selectHistoryTurnsSteps(projectedTurns, retainedIndices);
                return [summaryText, yield* formatHistoryMessagesSteps(retained, lossless)].filter(Boolean).join("\n\n");
            };
            let useLosslessHistory = (yield* formatRetained(false)).length > budget;
            let ordinaryTurnLimitReached = false;
            for (let index = turns.length - 1; index >= 0; index--) {
                yield;
                if (retainedIndices.has(index) || index === turns.length - 1 || turnEnds[index] <= summarizedPrefixCount
                    || ordinaryTurnLimitReached) continue;
                retainedIndices.add(index);
                if ((yield* formatRetained(useLosslessHistory)).length > budget) {
                    if (!useLosslessHistory && (yield* formatRetained(true)).length <= budget) {
                        useLosslessHistory = true;
                    } else {
                        retainedIndices.delete(index);
                        ordinaryTurnLimitReached = true;
                    }
                }
            }
            const text = yield* formatRetained(useLosslessHistory);
            const retainedMessageIndices = new Set<number>();
            let start = 0;
            for (const [index, turn] of turns.entries()) {
                yield;
                if (retainedIndices.has(index)) for (let offset = 0; offset < turn.length; offset++) {
                    retainedMessageIndices.add(start + offset);
                }
                start += turn.length;
            }
            const sourceMessages = history.filter((_message, index) =>
                index < summarizedPrefixCount || retainedMessageIndices.has(index));
            return withHistorySources({ text, compactedCount: summarizedPrefixCount, summaryChars: 0,
                ...(text.length > budget ? { historyBudgetLimited: true } : {}),
                semanticSummaryChars: semantic?.text.length ?? 0,
                omittedCount: history.length - sourceMessages.length, historyCompressed: true }, sourceMessages);
        }

        const semantic = summaries?.history;
        if (semantic?.text.trim() && (yield* isCurrentHistorySummarySteps(semantic, history))) {
            const summaryText = formatSemanticHistorySummary(semantic.text);
            const coveredMessages = semantic.sourceMessages.length;
            const remaining = history.slice(coveredMessages);
            const tail = yield* this.projectHistorySteps(
                remaining,
                Math.max(0, budget - summaryText.length - (remaining.length > 0 ? 2 : 0)),
                maxHistorySummaryChars,
                undefined,
                allowLossless,
            );
            // A valid semantic prefix is atomic. If even the prefix cannot fit,
            // leave it intact for the final-request guard rather than slice JSON
            // or silently lose the goals/decisions that motivated summarization.
            return withHistorySources({
                text: [summaryText, tail.text].filter(Boolean).join("\n\n"),
                compactedCount: coveredMessages + tail.compactedCount,
                summaryChars: tail.summaryChars,
                semanticSummaryChars: semantic.text.length,
                omittedCount: tail.omittedCount,
                historyCompressed: true,
            }, [...history.slice(0, coveredMessages), ...tail.sourceMessages]);
        }

        // Keep complete recent exchanges as a contiguous suffix. Count the
        // actual JSON, escaping and sandbox wrapper rather than raw contents.
        const turns = (yield* groupChatTurnsSteps(history)).filter((turn) =>
            turn.some((message) => message.role === "assistant"));
        let recentHistory: ChatMessage[] = [];
        let olderTurnCount = turns.length;
        for (let index = turns.length - 1; index >= 0; index--) {
            yield;
            const candidate = [...turns[index], ...recentHistory];
            if ((yield* formatHistoryMessagesSteps(candidate)).length > budget) break;
            recentHistory = candidate;
            olderTurnCount = index;
        }

        const olderHistory = turns.slice(0, olderTurnCount).flat();
        let summaryLimit = Math.min(Math.max(0, maxHistorySummaryChars), budget);
        let compacted = yield* this.compactor.compactChatHistorySteps(olderHistory, {
            recentTurns: 0,
            maxSummaryChars: summaryLimit,
        });
        let text = yield* formatProjectedHistorySteps(compacted.summary, recentHistory);
        // The digest is expendable before any chosen recent raw turn. Rebuild
        // whole lines to retain valid boundaries even when escaping expands it.
        while (compacted.summary && text.length > budget) {
            yield;
            summaryLimit = Math.max(0, summaryLimit - (text.length - budget));
            compacted = yield* this.compactor.compactChatHistorySteps(olderHistory, {
                recentTurns: 0,
                maxSummaryChars: summaryLimit,
            });
            text = yield* formatProjectedHistorySteps(compacted.summary, recentHistory);
        }
        return withHistorySources({
            text,
            compactedCount: compacted.compactedCount,
            summaryChars: compacted.summary.length,
            semanticSummaryChars: 0,
            omittedCount: history.length - recentHistory.length - compacted.compactedCount,
            historyCompressed: true,
        }, [
            ...olderHistory.slice(Math.max(0, olderHistory.length - compacted.compactedCount)),
            ...recentHistory,
        ]);
    }
}

function withHistorySources(
    history: Omit<PaAgentProjectedHistory, 'sourceMessages'>,
    sourceMessages: readonly ChatMessage[],
): PaAgentProjectedHistory {
    Object.defineProperty(history, 'sourceMessages', { value: [...sourceMessages] });
    return history as PaAgentProjectedHistory;
}

function* formatProjectedHistorySteps(summary: string, history: ChatMessage[]): Generator<void, string, void> {
    const summaryText = summary
        ? `<compaction_summary context_only="true">\n${escapeTaggedBoundary(summary, "compaction_summary")}\n</compaction_summary>`
        : "";
    const recentText = yield* formatHistoryMessagesSteps(history);
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
