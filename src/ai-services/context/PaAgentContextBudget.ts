export interface PaAgentContextBudgetSnapshot {
    promptChars: number;
    estimatedPromptTokens: number;
    toolObservationChars: number;
    maxPromptChars: number;
    maxObservationChars: number;
    observationUsageRatio: number;
    nearObservationLimit: boolean;
    providerUsage?: PaAgentProviderUsage;
    contextWindowTokens?: number;
    outputReserveTokens?: number;
    maxInputTokens?: number;
    contextWindowSource: "verified_metadata" | "explicit_configuration" | "unknown";
    outputReserveSource: "verified_metadata" | "explicit_configuration" | "unknown";
    estimateMethod: "cjk_text_and_serialized_schema" | "cjk_text_schema_image_reserve" | "chars_per_four";
    admissionBasis: "estimated_tokens" | "character_fallback";
    configurationOverflow: boolean;
}

export interface PaAgentModelBudgetFacts {
    contextWindowTokens?: number;
    outputReserveTokens?: number;
    contextWindowSource: "verified_metadata" | "explicit_configuration" | "unknown";
    outputReserveSource: "verified_metadata" | "explicit_configuration" | "unknown";
    /** Only a verified or explicitly configured output limit can be passed to AIUtils. */
    maxTokens?: number;
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
    actionHistoryChars?: number;
    maxPromptChars?: number;
    maxObservationChars?: number;
    /** Fully rendered request + bound schema estimate + local safety reserve. */
    localEnvelopeChars?: number;
    localEnvelopeEstimatedTokens?: number;
    localEnvelopeEstimateMethod?: "cjk_text_and_serialized_schema" | "cjk_text_schema_image_reserve";
    modelBudgetFacts?: PaAgentModelBudgetFacts;
}

const DEFAULT_MAX_PROMPT_CHARS = 120_000;
const DEFAULT_MAX_OBSERVATION_CHARS = 64_000;
const NEAR_OBSERVATION_LIMIT_RATIO = 0.7;
/** Existing 2,048-character request reserve converted at the ASCII 4:1 fallback ratio. */
const PROTOCOL_SAFETY_TOKENS = 512;

export function resolvePaAgentInputTokenLimit(facts: PaAgentModelBudgetFacts | undefined): number | undefined {
    if (!facts || facts.contextWindowSource === "unknown" || facts.outputReserveSource === "unknown") return undefined;
    const window = facts.contextWindowTokens;
    const reserve = facts.outputReserveTokens;
    if (!Number.isSafeInteger(window) || window! <= 0 || !Number.isSafeInteger(reserve) || reserve! <= 0) return undefined;
    return Math.max(0, window! - reserve! - PROTOCOL_SAFETY_TOKENS);
}

export function resolvePaAgentPromptCharCeiling(facts: PaAgentModelBudgetFacts | undefined, fallback: number): number {
    const inputTokens = resolvePaAgentInputTokenLimit(facts);
    return inputTokens === undefined ? fallback : Math.min(Number.MAX_SAFE_INTEGER, inputTokens * 4);
}

export class PaAgentContextBudget {
    private providerUsage: PaAgentProviderUsage | undefined;

    snapshot(input: PaAgentBudgetInput): PaAgentContextBudgetSnapshot {
        const promptChars = input.localEnvelopeChars ?? (input.input.length
            + input.availableSkills.length
            + input.toolDefinitions.length
            + input.toolObservations.length);
        const facts = input.modelBudgetFacts;
        const window = facts?.contextWindowTokens;
        const reserve = facts?.outputReserveTokens;
        const maxInputTokens = resolvePaAgentInputTokenLimit(facts);
        const configurationOverflow = maxInputTokens !== undefined && maxInputTokens <= 0;
        const tokenEstimateAvailable = input.localEnvelopeEstimatedTokens !== undefined
            && input.localEnvelopeEstimateMethod !== undefined;
        const admissionBasis = maxInputTokens !== undefined && tokenEstimateAvailable
            ? "estimated_tokens" as const : "character_fallback" as const;
        const maxPromptChars = admissionBasis === "estimated_tokens"
            ? resolvePaAgentPromptCharCeiling(facts, DEFAULT_MAX_PROMPT_CHARS)
            : input.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
        const maxObservationChars = input.maxObservationChars ?? DEFAULT_MAX_OBSERVATION_CHARS;
        const toolObservationChars = input.actionHistoryChars ?? (input.toolObservations === "None" ? 0 : input.toolObservations.length);
        const observationUsageRatio = maxObservationChars > 0
            ? toolObservationChars / maxObservationChars
            : 0;
        return {
            promptChars,
            estimatedPromptTokens: input.localEnvelopeEstimatedTokens ?? estimateTokensFromChars(promptChars),
            toolObservationChars,
            maxPromptChars,
            maxObservationChars,
            observationUsageRatio,
            nearObservationLimit: observationUsageRatio >= NEAR_OBSERVATION_LIMIT_RATIO,
            ...(this.providerUsage ? { providerUsage: { ...this.providerUsage } } : {}),
            ...(Number.isSafeInteger(window) && window! > 0 ? { contextWindowTokens: window } : {}),
            ...(Number.isSafeInteger(reserve) && reserve! > 0 ? { outputReserveTokens: reserve } : {}),
            ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
            contextWindowSource: facts?.contextWindowSource ?? "unknown",
            outputReserveSource: facts?.outputReserveSource ?? "unknown",
            estimateMethod: input.localEnvelopeEstimateMethod ?? "chars_per_four",
            admissionBasis,
            configurationOverflow,
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
