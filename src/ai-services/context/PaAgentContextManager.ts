import type { ChatMessage, PaAgentMessage } from "../chat-types";
import { PaAgentContextBudget, type PaAgentContextBudgetSnapshot, type PaAgentProviderUsage } from "./PaAgentContextBudget";
import { PaAgentContextCompactor } from "./PaAgentContextCompactor";
import { PaAgentContextHygiene } from "./PaAgentContextHygiene";
import { PaAgentContextProjector, type PaAgentInjectedContext } from "./PaAgentContextProjector";

export interface PaAgentContextManagerInput {
    prompt: string;
    chatHistory?: ChatMessage[];
    transcript: readonly PaAgentMessage[];
    turnIndex: number;
    hostContext?: string;
    runtimeInstruction?: string;
    injectedContext?: PaAgentInjectedContext;
    availableSkills: string;
    toolDefinitions: string;
    maxHistoryChars: number;
    maxPromptChars?: number;
    maxObservationChars: number;
    formatToolObservations: (transcript: readonly PaAgentMessage[], turnIndex: number) => string;
}

export interface PaAgentContextProjection {
    input: string;
    availableSkills: string;
    toolDefinitions: string;
    toolObservations: string;
    diagnostics: Record<string, unknown>;
    budget: PaAgentContextBudgetSnapshot;
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
        const micro = this.compactor.microCompact(hygiene.transcript, {
            maxObservationChars: input.maxObservationChars,
        });
        const projected = this.projector.projectUserInput({
            prompt: input.prompt,
            chatHistory: input.chatHistory,
            hostContext: input.hostContext,
            runtimeInstruction: input.runtimeInstruction,
            injectedContext: input.injectedContext,
            maxHistoryChars: input.maxHistoryChars,
        });
        const toolObservations = input.formatToolObservations(micro.transcript, input.turnIndex);
        const budget = this.budget.snapshot({
            input: projected.input,
            availableSkills: input.availableSkills,
            toolDefinitions: input.toolDefinitions,
            toolObservations,
            maxPromptChars: input.maxPromptChars,
            maxObservationChars: input.maxObservationChars,
        });

        return {
            input: projected.input,
            availableSkills: input.availableSkills,
            toolDefinitions: input.toolDefinitions,
            toolObservations,
            budget,
            diagnostics: {
                type: "context_projection",
                origins: this.projector.annotateOrigins(input.transcript),
                hygiene: {
                    removedEmptyAssistantMessages: hygiene.removedEmptyAssistantMessages,
                    hiddenStatusOnlyToolResults: hygiene.hiddenStatusOnlyToolResults,
                    removedOrphanToolResults: hygiene.removedOrphanToolResults,
                },
                microCompaction: {
                    compactedToolResults: micro.compactedToolResults,
                    originalObservationChars: micro.originalObservationChars,
                    compactedObservationChars: micro.compactedObservationChars,
                },
                historyCompaction: projected.history,
                budget,
            },
        };
    }
}
