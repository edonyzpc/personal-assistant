/* Copyright 2023 edonyzpc */

/**
 * Pagelet — LLM module barrel exports.
 *
 * Re-exports types, prompt builders, and the response parser so callers
 * can import from `./pagelet/llm` without reaching into submodules.
 */

export type {
    PromptScenario,
    StructuredFinding,
    StructuredLLMResponse,
    PromptBuildResult,
} from "./types";

export {
    buildPreloadPrompt,
    buildDiscoveryPrompt,
    buildPeriodicSummaryPrompt,
} from "./prompts";

export { parseStructuredResponse } from "./parse";
