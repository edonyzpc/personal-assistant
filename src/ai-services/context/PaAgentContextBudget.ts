export interface PaAgentContextBudgetSnapshot {
    promptChars: number;
    estimatedPromptTokens: number;
    toolObservationChars: number;
    maxPromptChars: number;
    maxObservationChars: number;
    observationUsageRatio: number;
    nearObservationLimit: boolean;
    providerUsage?: PaAgentProviderUsage;
}

export interface PaAgentProviderUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export interface PaAgentBudgetInput {
    input: string;
    availableSkills: string;
    toolDefinitions: string;
    toolObservations: string;
    maxPromptChars?: number;
    maxObservationChars?: number;
}

const DEFAULT_MAX_PROMPT_CHARS = 120_000;
const DEFAULT_MAX_OBSERVATION_CHARS = 64_000;
const NEAR_OBSERVATION_LIMIT_RATIO = 0.7;

export class PaAgentContextBudget {
    private providerUsage: PaAgentProviderUsage | undefined;

    snapshot(input: PaAgentBudgetInput): PaAgentContextBudgetSnapshot {
        const promptChars = input.input.length
            + input.availableSkills.length
            + input.toolDefinitions.length
            + input.toolObservations.length;
        const maxPromptChars = input.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
        const maxObservationChars = input.maxObservationChars ?? DEFAULT_MAX_OBSERVATION_CHARS;
        const toolObservationChars = input.toolObservations === "None" ? 0 : input.toolObservations.length;
        const observationUsageRatio = maxObservationChars > 0
            ? toolObservationChars / maxObservationChars
            : 0;
        return {
            promptChars,
            estimatedPromptTokens: estimateTokensFromChars(promptChars),
            toolObservationChars,
            maxPromptChars,
            maxObservationChars,
            observationUsageRatio,
            nearObservationLimit: observationUsageRatio >= NEAR_OBSERVATION_LIMIT_RATIO,
            ...(this.providerUsage ? { providerUsage: { ...this.providerUsage } } : {}),
        };
    }

    recordProviderUsage(usage: PaAgentProviderUsage | undefined): void {
        if (!usage) return;
        this.providerUsage = { ...usage };
    }
}

export function estimateTokensFromChars(chars: number): number {
    return Math.ceil(Math.max(0, chars) / 4);
}
