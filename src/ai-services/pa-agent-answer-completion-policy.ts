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
    appliedInsightActionReceipts: string[];
    equivalentNoProgressCounts: Map<string, number>;
    strategyChangeIssued: Set<string>;
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
    }
    | {
        action: "continue_recovery";
        reason: "recoverable_tool_failure" | "strategy_change_required";
        runtimeInstruction: string;
        toolMode: "normal";
    };

export function createAnswerCompletionLedger(): AnswerCompletionLedger {
    return {
        successfulEvidenceTools: new Set(),
        promptIncludedObservationTools: new Set(),
        failedEvidenceTools: new Set(),
        noNewInformationTools: new Set(),
        finalizationAttempted: false,
        emptyFinalizationRetryAttempted: false,
        appliedInsightActionReceipts: [],
        equivalentNoProgressCounts: new Map(),
        strategyChangeIssued: new Set(),
    };
}

export function deriveAnswerCompletionTurnFacts(summary: PaAgentTurnSummary): AnswerCompletionTurnFacts {
    // An accepted scope changes admission state but supplies no task evidence.
    // Keep it out of completion heuristics; the loop still charges its turn/budget.
    const observations = summary.toolResults.filter(result => !isAppliedSourceControl(result));
    const promptIncludedResults = observations.filter(hasPromptIncludedObservation);
    const successfulEvidenceResults = observations.filter(hasSuccessfulEvidence);
    const duplicateOrNoopResults = observations.filter(isDuplicateOrNoopResult);
    const failureOrStatusResults = observations.filter(isFailureOrStatusResult);

    return {
        hasFinalText: summary.committedFinalText.trim().length > 0,
        assistantEmpty: summary.status === "incomplete"
            && summary.diagnostics.some((diagnostic) => diagnostic.type === "assistant_empty_response"),
        hasToolCalls: summary.toolCalls.length > 0,
        hasToolResults: summary.toolResults.length > 0,
        hasNewSuccessfulEvidence: successfulEvidenceResults.length > 0,
        hasPromptIncludedObservation: promptIncludedResults.length > 0,
        hasOnlyDuplicateOrNoopResults: observations.length > 0
            && observations.every(isDuplicateOrNoopResult),
        hasOnlyFailureOrStatusResults: observations.length > 0
            && successfulEvidenceResults.length === 0
            && failureOrStatusResults.length > 0
            && observations.every((result) => isFailureOrStatusResult(result) || isDuplicateOrNoopResult(result)),
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
        if (isAppliedSourceControl(result)) continue;
        const appliedInsightReceipt = parseAppliedInsightActionReceipt(result);
        if (appliedInsightReceipt && !ledger.appliedInsightActionReceipts.includes(appliedInsightReceipt)) {
            ledger.appliedInsightActionReceipts.push(appliedInsightReceipt);
        }
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
        return recoverFromFailure(input.ledger, input.summary, failedRequiredCapabilities, true);
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
        if (input.ledger.successfulEvidenceTools.size > 0) {
            return forceFinalizeOnce(input.ledger, "duplicate_only", facts.duplicateOrNoopToolNames);
        }
        if (input.ledger.failedEvidenceTools.size > 0) {
            return recoverFromFailure(
                input.ledger,
                input.summary,
                [...input.ledger.failedEvidenceTools],
                false,
            );
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
        return recoverFromFailure(input.ledger, input.summary, facts.failedToolNames, false);
    }

    return { action: "continue_tooling", reason: "tool_chain_allowed" };
}

function recoverFromFailure(
    ledger: AnswerCompletionLedger,
    summary: PaAgentTurnSummary,
    toolNames: readonly string[],
    required: boolean,
): AnswerCompletionDecision {
    const observations = summary.toolResults.filter((result) => isFailureOrStatusResult(result));
    const signature = JSON.stringify(observations.map((result) => ({
        tool: result.toolName,
        outcome: result.content.metadata?.outcome ?? "unknown",
        reason: result.content.metadata?.reason ?? "unknown",
        executionState: result.content.metadata?.executionState ?? "unknown",
    })).sort((left, right) => `${left.tool}:${left.reason}`.localeCompare(`${right.tool}:${right.reason}`)));
    const count = (ledger.equivalentNoProgressCounts.get(signature) ?? 0) + 1;
    ledger.equivalentNoProgressCounts.set(signature, count);
    const names = [...new Set(toolNames)].join(", ") || "the attempted tool";

    if (count >= 4 && ledger.strategyChangeIssued.has(signature)) {
        return {
            action: "stop_incomplete",
            reason: "equivalent_no_progress",
            diagnostics: [{
                type: "equivalent_no_progress",
                message: "The task could not make progress after an explicit strategy change.",
                tools: [...new Set(toolNames)],
                attempts: count,
                required,
            }],
        };
    }

    if (count >= 3) {
        ledger.strategyChangeIssued.add(signature);
        return {
            action: "continue_recovery",
            reason: "strategy_change_required",
            toolMode: "normal",
            runtimeInstruction: `${names} has produced the same non-progress result ${count} times. Change strategy now: correct the input, use another currently allowed capability, refresh only the specifically required input, or query an existing operation. Do not repeat an unknown side effect, perturb arguments randomly, or claim progress from this instruction.`,
        };
    }

    return {
        action: "continue_recovery",
        reason: "recoverable_tool_failure",
        toolMode: "normal",
        runtimeInstruction: `${names} returned a recoverable observation. Inspect its actual outcome and allowed recovery actions. Retry the same read-only call only when the failure is temporary, otherwise correct the input or choose another currently allowed path. If a side effect is partial or acceptance is unknown, verify or continue only the remaining parts; do not submit it again blindly.`,
    };
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
        "Do not simulate tool execution by printing tool-call markup or a plan to call unavailable tools. Answer directly from actual results; a failed read does not establish that the note is missing.",
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
            runtimeInstruction: [
                buildAnswerFinalizationInstruction(reason, toolNames),
                ...(ledger.appliedInsightActionReceipts.length > 0 ? [
                    `The host already applied these Saved Insight actions: ${ledger.appliedInsightActionReceipts.join("; ")}. No new tools are available in this finalization turn, but those actions have completed. Report their actual applied results; do not say they were unavailable or unsaved.`,
                ] : []),
            ].join(" "),
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

function parseAppliedInsightActionReceipt(result: PaAgentTurnSummary["toolResults"][number]): string | null {
    if (result.toolName !== "manage_saved_insight" || result.isError || !result.content.promptText) return null;
    let payload: unknown;
    try {
        payload = JSON.parse(result.content.promptText);
    } catch {
        return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const envelope = payload as Record<string, unknown>;
    const observation = envelope.observation;
    if (envelope.tool !== "manage_saved_insight" || !observation || typeof observation !== "object") return null;
    const action = observation as Record<string, unknown>;
    if (action.kind !== "insight-action" || action.status !== "applied"
        || !["save", "later", "archive", "restore"].includes(String(action.action))) return null;
    return JSON.stringify({
        action: action.action,
        status: "applied",
        ...(typeof action.insightId === "string" ? { insightId: action.insightId } : {}),
        ...(typeof action.reviewItemId === "string" ? { reviewItemId: action.reviewItemId } : {}),
        ...(typeof action.insightStatus === "string" ? { insightStatus: action.insightStatus } : {}),
        ...(typeof action.updatedAt === "string" ? { updatedAt: action.updatedAt } : {}),
        ...(action.influencePolicy === "weak-only" ? { influencePolicy: "weak-only" } : {}),
    });
}

function isAppliedSourceControl(result: PaAgentTurnSummary["toolResults"][number]): boolean {
    return !result.isError
        && result.toolName === "declare_source_scope"
        && result.content.metadata?.outcome === "control_applied"
        && result.content.metadata?.sourceScopeControl === true
        && result.content.metadata?.preflightOnly === true;
}

function hasPromptIncludedObservation(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    return result.content.includeInNextPrompt && result.content.promptText.trim().length > 0;
}

function hasSuccessfulEvidence(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    if (
        result.toolName === "search_memory"
        && (
            result.content.metadata?.memoryEvidenceState === "none"
            || result.content.metadata?.memoryEvidenceState === "unavailable"
        )
    ) return false;
    return !result.isError
        && (result.content.metadata?.outcome === "success" || result.content.metadata?.outcome === "reused_result")
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
    if (
        result.toolName === "search_memory"
        && (
            result.content.metadata?.memoryEvidenceState === "none"
            || result.content.metadata?.memoryEvidenceState === "unavailable"
        )
    ) return true;
    return result.isError
        || result.content.metadata?.outcome === "recoverable_error"
        || result.content.metadata?.outcome === "schema_invalid"
        || result.content.metadata?.outcome === "policy_rejected"
        || result.content.metadata?.outcome === "budget_exceeded";
}

function uniqueToolNames(results: PaAgentTurnSummary["toolResults"]): string[] {
    return [...new Set(results.map((result) => result.toolName))];
}
