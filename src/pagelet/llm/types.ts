/* Copyright 2023 edonyzpc */

/**
 * Pagelet — LLM structured output types.
 *
 * Defines the cross-scenario contract between prompt builders, the LLM
 * response parser, and the callbacks wired into the Pagelet orchestrator.
 */

// ---------------------------------------------------------------------------
// Prompt scenarios
// ---------------------------------------------------------------------------

/** Identifies which scenario a prompt is built for. */
export type PromptScenario =
    | "preload"
    | "quick-review"
    | "writing-assist"
    | "discovery";

// ---------------------------------------------------------------------------
// Structured finding (LLM output shape)
// ---------------------------------------------------------------------------

/** A single finding extracted from the LLM response. */
export interface StructuredFinding {
    text: string;
    sourceFile: string;
    sourceTitle: string;
    category?: "insight" | "action" | "connection" | "gap";
}

/** Parsed LLM response envelope. */
export interface StructuredLLMResponse {
    findings: StructuredFinding[];
    summary?: string;
}

// ---------------------------------------------------------------------------
// Prompt build result
// ---------------------------------------------------------------------------

/** Output of a scenario-specific prompt builder. */
export interface PromptBuildResult {
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
}
