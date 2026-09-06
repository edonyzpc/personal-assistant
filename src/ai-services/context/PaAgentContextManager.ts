import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { PaAgentContextBudget, type PaAgentContextBudgetSnapshot, type PaAgentProviderUsage } from "./PaAgentContextBudget";
import { PaAgentContextCompactor } from "./PaAgentContextCompactor";
import { PaAgentContextHygiene } from "./PaAgentContextHygiene";
import { PaAgentContextProjector, type PaAgentInjectedContext } from "./PaAgentContextProjector";
import type { PaAgentContextSummaries } from "./PaAgentContextSummaryTypes";

export interface PaAgentContextManagerInput {
    prompt: string;
    chatHistory?: ChatMessage[];
    transcript: readonly PaAgentMessage[];
    turnIndex: number;
    hostContext?: string;
    runtimeInstruction?: string;
    injectedContext?: PaAgentInjectedContext;
    summaries?: PaAgentContextSummaries;
    availableSkills: string;
    toolDefinitions: string;
    maxHistoryChars: number;
    maxPromptChars?: number;
    maxObservationChars: number;
    formatToolObservations: (transcript: readonly PaAgentMessage[], turnIndex: number) => string;
    /** Runtime owns actual template/schema formatting; the reducer remains provider-free. */
    measurePromptChars?: (parts: PaAgentContextParts) => number;
}

export interface PaAgentContextParts {
    input: string;
    availableSkills: string;
    toolDefinitions: string;
    toolObservations: string;
}

export interface PaAgentContextOutcome {
    historyCompressed: boolean;
    toolResultsCompacted: number;
    toolResultsHardTruncated: number;
    budgetLimited: boolean;
    admission: "fit" | "local_overflow";
}

export interface PaAgentContextProjection extends PaAgentContextParts {
    diagnostics: Record<string, unknown>;
    budget: PaAgentContextBudgetSnapshot;
    outcome: PaAgentContextOutcome;
    historyBudgetChars: number;
    reducedToolMessageIds: string[];
}

export class PaAgentContextManager {
    private readonly hygiene: PaAgentContextHygiene;
    private readonly compactor: PaAgentContextCompactor;
    private readonly projector: PaAgentContextProjector;
    private readonly budget: PaAgentContextBudget;

    constructor(options: {
        hygiene?: PaAgentContextHygiene;
        compactor?: PaAgentContextCompactor;
        projector?: PaAgentContextProjector;
        budget?: PaAgentContextBudget;
    } = {}) {
        this.hygiene = options.hygiene ?? new PaAgentContextHygiene();
        this.compactor = options.compactor ?? new PaAgentContextCompactor();
        this.projector = options.projector ?? new PaAgentContextProjector(this.compactor);
        this.budget = options.budget ?? new PaAgentContextBudget();
    }

    recordProviderUsage(usage: PaAgentProviderUsage | undefined): void {
        this.budget.recordProviderUsage(usage);
    }

    forPrompt(input: PaAgentContextManagerInput): PaAgentContextProjection {
        const hygiene = this.hygiene.clean(input.transcript);
        let micro = this.compactor.microCompact(hygiene.transcript, {
            maxObservationChars: input.maxObservationChars,
            summaries: input.summaries,
            canonicalTranscript: hygiene.transcript,
        });
        let historyBudget = input.maxHistoryChars;
        let summaryBudget: number | undefined;
        let rebuilds = 0;
        const projectHistory = () => this.projector.projectUserInput({
            prompt: input.prompt,
            chatHistory: input.chatHistory,
            hostContext: input.hostContext,
            runtimeInstruction: input.runtimeInstruction,
            injectedContext: input.injectedContext,
            maxHistoryChars: historyBudget,
            maxHistorySummaryChars: summaryBudget,
            summaries: input.summaries,
        });
        let projected = projectHistory();
        let parts: PaAgentContextParts;
        const measure = () => {
            parts = {
                input: projected.input,
                availableSkills: input.availableSkills,
                toolDefinitions: input.toolDefinitions,
                toolObservations: input.formatToolObservations(micro.transcript, input.turnIndex),
            };
            return this.budget.snapshot({
                ...parts,
                maxPromptChars: input.maxPromptChars,
                maxObservationChars: input.maxObservationChars,
                localEnvelopeChars: input.measurePromptChars?.(parts),
            });
        };
        let budget = measure();
        const firstPromptChars = budget.promptChars;
        const observationChars = () => micro.transcript.reduce((sum, message) => (
            sum + (message.role === "toolResult" && message.content.includeInNextPrompt
                ? message.content.promptText.length : 0)
        ), 0);
        const reduceTools = (maxChars: number, allowRecentHardTruncation: boolean) => {
            micro = this.compactor.microCompact(micro.transcript, {
                maxObservationChars: maxChars,
                triggerRatio: 0,
                targetRatio: 0,
                allowRecentHardTruncation,
                summaries: input.summaries,
                canonicalTranscript: hygiene.transcript,
            });
            rebuilds++;
            budget = measure();
        };
        // The lane cap includes escaping and wrappers, not just raw observation text.
        // Two passes are bounded; irreducible markers remain for final fail-closed admission.
        for (let pass = 0; pass < 2 && budget.toolObservationChars > input.maxObservationChars; pass++) {
            reduceTools(Math.max(0, observationChars() - (budget.toolObservationChars - input.maxObservationChars)), true);
        }
        const excess = () => Math.max(0, budget.promptChars - budget.maxPromptChars);
        if (excess() > 0) {
            // One ordered stronger projection. Reuse clones, never rewrite the canonical inputs.
            reduceTools(Math.max(input.maxObservationChars, observationChars()), false);
            if (excess() > 0) reduceTools(Math.max(0, observationChars() - excess()), false);
            if (excess() > 0 && projected.history.summaryChars > 0) {
                summaryBudget = Math.max(0, projected.history.summaryChars - excess());
                projected = projectHistory();
                rebuilds++;
                budget = measure();
            }
            if (excess() > 0 && projected.history.summaryChars > 0) {
                summaryBudget = 0;
                projected = projectHistory();
                rebuilds++;
                budget = measure();
            }
            if (excess() > 0 && projected.history.text.length > 0) {
                summaryBudget = 0;
                historyBudget = Math.max(0, projected.history.text.length - excess());
                projected = projectHistory();
                rebuilds++;
                budget = measure();
            }
            if (excess() > 0) reduceTools(Math.max(0, observationChars() - excess()), true);
        }
        const finalToolResults = micro.transcript.filter((message) => message.role === "toolResult");
        const toolResultsCompacted = finalToolResults.filter((message) => message.content.metadata?.compacted === true).length;
        const toolResultsHardTruncated = finalToolResults.filter((message) => message.content.metadata?.contextBudgetTruncated === true).length;
        const outcome: PaAgentContextOutcome = {
            historyCompressed: projected.history.historyCompressed,
            toolResultsCompacted,
            toolResultsHardTruncated,
            budgetLimited: toolResultsHardTruncated > 0 || projected.history.omittedCount > 0,
            admission: budget.promptChars <= budget.maxPromptChars
                && budget.toolObservationChars <= input.maxObservationChars ? "fit" : "local_overflow",
        };

        return {
            ...parts!,
            budget,
            outcome,
            historyBudgetChars: historyBudget,
            reducedToolMessageIds: finalToolResults.filter((message) =>
                message.content.metadata?.compacted === true || message.content.metadata?.contextBudgetTruncated === true)
                .map((message) => message.id),
            diagnostics: {
                type: "context_projection",
                historyBudgetChars: historyBudget,
                outcome,
                hygiene: {
                    removedEmptyAssistantMessages: hygiene.removedEmptyAssistantMessages,
                    hiddenStatusOnlyToolResults: hygiene.hiddenStatusOnlyToolResults,
                    removedOrphanToolResults: hygiene.removedOrphanToolResults,
                },
                microCompaction: {
                    compactedToolResults: toolResultsCompacted,
                    hardTruncatedToolResults: toolResultsHardTruncated,
                    semanticSummaryUsed: finalToolResults.some((message) => message.content.metadata?.contextSemanticSummaryUsed === true),
                    semanticToolSummaries: finalToolResults.filter((message) => message.content.metadata?.contextSemanticSummaryUsed === true).length,
                    compactedObservationChars: observationChars(),
                    budgetDrivenRecompaction: rebuilds > 0 && budget.promptChars < firstPromptChars,
                },
                historyCompaction: {
                    compactedCount: projected.history.compactedCount,
                    omittedCount: projected.history.omittedCount,
                    summaryChars: projected.history.summaryChars,
                    semanticSummaryChars: projected.history.semanticSummaryChars ?? 0,
                    semanticSummaryUsed: (projected.history.semanticSummaryChars ?? 0) > 0,
                    historyCompressed: projected.history.historyCompressed,
                },
                rebuilds,
                budget,
            },
        };
    }
}
