import type {
    PaAgentTurnSummary,
} from "./pa-agent-loop";

export type AnswerCompletionToolMode = "normal" | "final_answer_only";

export type AnswerCompletionForceReason =
    | "tool_failure"
    | "duplicate_only"
    | "empty_after_observation"
    | "required_tool_failed";

export interface AnswerCompletionTurnFacts {
    hasFinalText: boolean;
    assistantEmpty: boolean;
    hasToolCalls: boolean;
    hasToolResults: boolean;
    hasNewSuccessfulEvidence: boolean;
    hasPromptIncludedObservation: boolean;
    hasOnlyDuplicateOrNoopResults: boolean;
    hasOnlyFailureOrStatusResults: boolean;
    failedToolNames: string[];
    duplicateOrNoopToolNames: string[];
}

export interface AnswerCompletionLedger {
    successfulEvidenceTools: Set<string>;
    promptIncludedObservationTools: Set<string>;
    failedEvidenceTools: Set<string>;
    noNewInformationTools: Set<string>;
    finalizationAttempted: boolean;
    emptyFinalizationRetryAttempted: boolean;
}

export type AnswerCompletionDecision =
    | {
        action: "continue_tooling";
        reason: "new_tool_evidence" | "tool_chain_allowed";
    }
    | {
        action: "force_finalize";
        reason: AnswerCompletionForceReason;
        runtimeInstruction: string;
        toolMode: "final_answer_only";
    }
    | {
        action: "stop_incomplete";
        reason: string;
        diagnostics: Array<Record<string, unknown>>;
    };

export function createAnswerCompletionLedger(): AnswerCompletionLedger {
    return {
        successfulEvidenceTools: new Set(),
        promptIncludedObservationTools: new Set(),
        failedEvidenceTools: new Set(),
        noNewInformationTools: new Set(),
        finalizationAttempted: false,
        emptyFinalizationRetryAttempted: false,
    };
}

export function deriveAnswerCompletionTurnFacts(summary: PaAgentTurnSummary): AnswerCompletionTurnFacts {
    const promptIncludedResults = summary.toolResults.filter(hasPromptIncludedObservation);
    const successfulEvidenceResults = summary.toolResults.filter(hasSuccessfulEvidence);
    const duplicateOrNoopResults = summary.toolResults.filter(isDuplicateOrNoopResult);
    const failureOrStatusResults = summary.toolResults.filter(isFailureOrStatusResult);

    return {
        hasFinalText: summary.committedFinalText.trim().length > 0,
        assistantEmpty: summary.status === "incomplete"
            && summary.diagnostics.some((diagnostic) => diagnostic.type === "assistant_empty_response"),
        hasToolCalls: summary.toolCalls.length > 0,
        hasToolResults: summary.toolResults.length > 0,
        hasNewSuccessfulEvidence: successfulEvidenceResults.length > 0,
        hasPromptIncludedObservation: promptIncludedResults.length > 0,
        hasOnlyDuplicateOrNoopResults: summary.toolResults.length > 0
            && summary.toolResults.every(isDuplicateOrNoopResult),
        hasOnlyFailureOrStatusResults: summary.toolResults.length > 0
            && successfulEvidenceResults.length === 0
            && failureOrStatusResults.length > 0
            && summary.toolResults.every((result) => isFailureOrStatusResult(result) || isDuplicateOrNoopResult(result)),
        failedToolNames: uniqueToolNames(failureOrStatusResults),
        duplicateOrNoopToolNames: uniqueToolNames(duplicateOrNoopResults),
    };
}

export function recordAnswerCompletionTurn(
    ledger: AnswerCompletionLedger,
    summary: PaAgentTurnSummary,
    facts: AnswerCompletionTurnFacts = deriveAnswerCompletionTurnFacts(summary),
): void {
    for (const result of summary.toolResults) {
        if (hasSuccessfulEvidence(result)) {
            ledger.successfulEvidenceTools.add(result.toolName);
        }
        if (hasPromptIncludedObservation(result)) {
            ledger.promptIncludedObservationTools.add(result.toolName);
        }
        if (isFailureOrStatusResult(result)) {
            ledger.failedEvidenceTools.add(result.toolName);
        }
        if (isDuplicateOrNoopResult(result)) {
            ledger.noNewInformationTools.add(result.toolName);
        }
    }

    if (facts.hasPromptIncludedObservation) {
        facts.failedToolNames.forEach((tool) => ledger.promptIncludedObservationTools.add(tool));
    }
}

export function decideAnswerCompletion(input: {
    summary: PaAgentTurnSummary;
    ledger: AnswerCompletionLedger;
    facts?: AnswerCompletionTurnFacts;
    failedRequiredCapabilities?: string[];
}): AnswerCompletionDecision | undefined {
    const facts = input.facts ?? deriveAnswerCompletionTurnFacts(input.summary);
    if (facts.hasFinalText) return undefined;
    if (input.summary.status === "aborted" || input.summary.status === "error") return undefined;

    const failedRequiredCapabilities = input.failedRequiredCapabilities ?? [];
    if (failedRequiredCapabilities.length > 0) {
        return forceFinalizeOnce(input.ledger, "required_tool_failed", failedRequiredCapabilities);
    }

    if (facts.assistantEmpty && input.ledger.promptIncludedObservationTools.size > 0) {
        if (!input.ledger.emptyFinalizationRetryAttempted) {
            input.ledger.emptyFinalizationRetryAttempted = true;
            return forceFinalizeOnce(input.ledger, "empty_after_observation", [
                ...input.ledger.promptIncludedObservationTools,
            ]);
        }
        return {
            action: "stop_incomplete",
            reason: "empty_after_finalization",
            diagnostics: [{
                type: "assistant_empty_response",
                message: "The assistant produced no final answer after available observations were provided.",
            }],
        };
    }

    if (input.summary.status !== "tool_results_ready") {
        return undefined;
    }

    if (facts.hasNewSuccessfulEvidence) {
        return { action: "continue_tooling", reason: "new_tool_evidence" };
    }

    if (facts.hasOnlyDuplicateOrNoopResults) {
        if (input.ledger.successfulEvidenceTools.size > 0 || input.ledger.promptIncludedObservationTools.size > 0) {
            return forceFinalizeOnce(input.ledger, "duplicate_only", facts.duplicateOrNoopToolNames);
        }
        return {
            action: "stop_incomplete",
            reason: "duplicate_tool_call_without_answer",
            diagnostics: [{
                type: "duplicate_tool_call_without_answer",
                message: "The assistant requested already gathered context without producing a final answer.",
                tools: facts.duplicateOrNoopToolNames,
            }],
        };
    }

    if (facts.hasOnlyFailureOrStatusResults || facts.hasPromptIncludedObservation) {
        return forceFinalizeOnce(input.ledger, "tool_failure", facts.failedToolNames);
    }

    return { action: "continue_tooling", reason: "tool_chain_allowed" };
}

export function buildAnswerFinalizationInstruction(
    reason: AnswerCompletionForceReason,
    toolNames: readonly string[] = [],
): string {
    const toolList = toolNames.length > 0 ? [...new Set(toolNames)].join(", ") : "the prior tools";
    const reasonLine = (() => {
        switch (reason) {
            case "required_tool_failed":
                return `${toolList} already returned an unavailable, invalid, or failed result.`;
            case "tool_failure":
                return `${toolList} returned only unavailable, invalid, skipped, or status observations.`;
            case "duplicate_only":
                return `${toolList} has already been gathered or produced no new information.`;
            case "empty_after_observation":
                return "The previous assistant turn ended without final answer text after observations were provided.";
        }
    })();
    return [
        reasonLine,
        "This is a finalization turn. Do not call tools.",
        "Use only the existing observations and available context to produce the final answer.",
        "If the requested evidence is unavailable or insufficient, say that directly without claiming unavailable evidence.",
    ].join(" ");
}

function forceFinalizeOnce(
    ledger: AnswerCompletionLedger,
    reason: AnswerCompletionForceReason,
    toolNames: readonly string[],
): AnswerCompletionDecision {
    if (!ledger.finalizationAttempted) {
        ledger.finalizationAttempted = true;
        return {
            action: "force_finalize",
            reason,
            runtimeInstruction: buildAnswerFinalizationInstruction(reason, toolNames),
            toolMode: "final_answer_only",
        };
    }
    const diagnosticType = reason === "duplicate_only"
        ? "duplicate_tool_call_without_answer"
        : `${reason}_without_answer`;
    return {
        action: "stop_incomplete",
        reason: diagnosticType,
        diagnostics: [{
            type: diagnosticType,
            message: "The assistant did not produce a final answer after the runtime requested finalization from available context.",
            tools: [...new Set(toolNames)],
        }],
    };
}

function hasPromptIncludedObservation(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    return result.content.includeInNextPrompt && result.content.promptText.trim().length > 0;
}

function hasSuccessfulEvidence(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    return !result.isError
        && result.content.metadata?.outcome === "success"
        && hasPromptIncludedObservation(result);
}

function isDuplicateOrNoopResult(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    return result.content.metadata?.outcome === "duplicate_skipped"
        || (!result.content.includeInNextPrompt && result.content.promptText.trim().length === 0);
}

function isFailureOrStatusResult(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    if (result.content.metadata?.outcome === "duplicate_skipped") return false;
    return result.isError
        || result.content.metadata?.outcome === "recoverable_error"
        || result.content.metadata?.outcome === "schema_invalid"
        || result.content.metadata?.outcome === "policy_rejected"
        || result.content.metadata?.outcome === "budget_exceeded";
}

function uniqueToolNames(results: PaAgentTurnSummary["toolResults"]): string[] {
    return [...new Set(results.map((result) => result.toolName))];
}
