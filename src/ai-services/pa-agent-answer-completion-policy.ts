import type {
    PaAgentTurnSummary,
} from "./pa-agent-loop";
import { HostProgressLedger, appliedInsightReceipt, preparedWritingContextSelection } from "./pa-agent-progress";
import { parseVaultObservationEvidence } from "./vault-observation-evidence";

export type AnswerCompletionToolMode = "normal" | "final_answer_only";

export type AnswerCompletionForceReason =
    | "tool_failure"
    | "duplicate_only"
    | "repeated_no_match"
    | "empty_after_observation";

export interface AnswerCompletionTurnFacts {
    hasFinalText: boolean;
    assistantEmpty: boolean;
    hasToolCalls: boolean;
    hasToolResults: boolean;
    hasNewSuccessfulEvidence: boolean;
    hasPromptIncludedObservation: boolean;
    hasOnlyDuplicateOrNoopResults: boolean;
    hasRepeatedSuccessfulEvidence: boolean;
    hasOnlyFailureOrStatusResults: boolean;
    hasOnlyNoMatchResults: boolean;
    failedToolNames: string[];
    duplicateOrNoopToolNames: string[];
}

export interface AnswerCompletionLedger {
    hostProgress: HostProgressLedger;
    progressEpoch: number;
    successfulEvidenceTools: Set<string>;
    successfulObservationKeys: Set<string>;
    memoryObservationKeys: Set<string>;
    repeatedEvidenceNoProgressCount: number;
    consecutiveEmptyVaultNoMatchTurns: number;
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
        reason: "new_tool_evidence" | "tool_chain_allowed" | "normal_no_match";
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
        hostProgress: new HostProgressLedger(),
        progressEpoch: 0,
        successfulEvidenceTools: new Set(),
        successfulObservationKeys: new Set(),
        memoryObservationKeys: new Set(),
        repeatedEvidenceNoProgressCount: 0,
        consecutiveEmptyVaultNoMatchTurns: 0,
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

export function deriveAnswerCompletionTurnFacts(
    summary: PaAgentTurnSummary,
    ledger?: AnswerCompletionLedger,
): AnswerCompletionTurnFacts {
    // An accepted scope changes admission state but supplies no task evidence.
    // Keep it out of completion heuristics; the loop still charges its turn/budget.
    const observations = summary.toolResults;
    const promptIncludedResults = observations.filter(hasPromptIncludedObservation);
    const hostReceipts = (ledger?.hostProgress ?? new HostProgressLedger()).preview(observations);
    const seenThisTurn = new Set<string>();
    const repeatedSuccesses = new Set<PaAgentTurnSummary["toolResults"][number]>();
    const successfulEvidenceResults = observations.filter((result, index) => {
        if (!hasSuccessfulEvidence(result)) return false;
        if (result.content.metadata?.outcome === "reused_result") {
            repeatedSuccesses.add(result);
            return false;
        }
        const keys = successfulObservationKeys(result, hostReceipts[index]);
        const hasNewReceipt = keys.some(key => !ledger?.successfulObservationKeys.has(key)
            && !seenThisTurn.has(key));
        keys.forEach(key => seenThisTurn.add(key));
        if (!hasNewReceipt) {
            repeatedSuccesses.add(result);
            return false;
        }
        return true;
    });
    const duplicateOrNoopResults = observations.filter(result =>
        isDuplicateOrNoopResult(result) || repeatedSuccesses.has(result));
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
            && observations.every(result => isDuplicateOrNoopResult(result) || repeatedSuccesses.has(result)),
        hasRepeatedSuccessfulEvidence: repeatedSuccesses.size > 0,
        hasOnlyFailureOrStatusResults: observations.length > 0
            && successfulEvidenceResults.length === 0
            && failureOrStatusResults.length > 0
            && observations.every((result) => isFailureOrStatusResult(result) || isDuplicateOrNoopResult(result)),
        hasOnlyNoMatchResults: observations.length > 0
            && observations.every(result => result.content.resultFact?.kind === "no_match"),
        failedToolNames: uniqueToolNames(failureOrStatusResults),
        duplicateOrNoopToolNames: uniqueToolNames(duplicateOrNoopResults),
    };
}

export function recordAnswerCompletionTurn(
    ledger: AnswerCompletionLedger,
    summary: PaAgentTurnSummary,
    facts: AnswerCompletionTurnFacts = deriveAnswerCompletionTurnFacts(summary),
): void {
    const hostReceipts = ledger.hostProgress.preview(summary.toolResults);
    const advanced = ledger.hostProgress.record(summary.toolResults);
    ledger.progressEpoch = summary.progressEpoch ?? ledger.hostProgress.epoch;
    if (advanced) ledger.repeatedEvidenceNoProgressCount = 0;
    if (summary.toolResults.length > 0) {
        const noMatchOrUnavailableMemory = summary.toolResults.every(result =>
            result.content.resultFact?.kind === "no_match"
            || (result.toolName === "search_memory"
                && result.content.resultFact?.kind === "unavailable"));
        const hasEmptyVaultNoMatch = summary.toolResults.some(isEmptyVaultNoMatch);
        ledger.consecutiveEmptyVaultNoMatchTurns = noMatchOrUnavailableMemory && hasEmptyVaultNoMatch
            ? ledger.consecutiveEmptyVaultNoMatchTurns + 1 : 0;
    }
    for (const [index, result] of summary.toolResults.entries()) {
        const insightReceipt = appliedInsightReceipt(result);
        if (insightReceipt && !ledger.appliedInsightActionReceipts.includes(insightReceipt)) {
            ledger.appliedInsightActionReceipts.push(insightReceipt);
        }
        if (hasSuccessfulEvidence(result)) {
            ledger.successfulEvidenceTools.add(result.toolName);
            successfulObservationKeys(result, hostReceipts[index]).forEach(key => {
                ledger.successfulObservationKeys.add(key);
                if (result.toolName === "search_memory") ledger.memoryObservationKeys.add(key);
            });
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

/** The provider's current Memory projection replaces earlier Memory facts after revocation. */
export function synchronizeProjectedMemoryCompletion(
    ledger: AnswerCompletionLedger,
    transcript: readonly import("./chat-types").PaAgentMessage[],
): void {
    const projected = transcript.filter((message): message is Extract<import("./chat-types").PaAgentMessage, { role: "toolResult" }> =>
        message.role === "toolResult" && message.toolName === "search_memory");
    // This is the complete current provider transcript. Revocation may remove
    // every Memory result, so an empty projection also withdraws prior facts.
    for (const key of ledger.memoryObservationKeys) ledger.successfulObservationKeys.delete(key);
    ledger.memoryObservationKeys.clear();
    ledger.successfulEvidenceTools.delete("search_memory");
    ledger.promptIncludedObservationTools.delete("search_memory");
    ledger.failedEvidenceTools.delete("search_memory");
    const receipts = ledger.hostProgress.preview(projected);
    for (const [index, result] of projected.entries()) {
        if (hasSuccessfulEvidence(result)) {
            ledger.successfulEvidenceTools.add("search_memory");
            successfulObservationKeys(result, receipts[index]).forEach(key => {
                ledger.successfulObservationKeys.add(key);
                ledger.memoryObservationKeys.add(key);
            });
        }
        if (hasPromptIncludedObservation(result)) ledger.promptIncludedObservationTools.add("search_memory");
        if (isFailureOrStatusResult(result)) ledger.failedEvidenceTools.add("search_memory");
    }
}

export function decideAnswerCompletion(input: {
    summary: PaAgentTurnSummary;
    ledger: AnswerCompletionLedger;
    facts?: AnswerCompletionTurnFacts;
}): AnswerCompletionDecision | undefined {
    const facts = input.facts ?? deriveAnswerCompletionTurnFacts(input.summary);
    if (facts.hasFinalText) return undefined;
    if (input.summary.status === "aborted" || input.summary.status === "error") return undefined;

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

    if (input.ledger.consecutiveEmptyVaultNoMatchTurns >= 2) {
        return forceFinalizeOnce(input.ledger, "repeated_no_match",
            uniqueToolNames(input.summary.toolResults));
    }

    if (facts.hasOnlyNoMatchResults) {
        return { action: "continue_tooling", reason: "normal_no_match" };
    }

    if (facts.hasOnlyDuplicateOrNoopResults) {
        if (input.ledger.successfulEvidenceTools.size > 0) {
            if (facts.hasRepeatedSuccessfulEvidence) {
                return recoverFromRepeatedEvidence(input.ledger, facts.duplicateOrNoopToolNames);
            }
            return forceFinalizeOnce(input.ledger, "duplicate_only", facts.duplicateOrNoopToolNames);
        }
        if (input.ledger.failedEvidenceTools.size > 0) {
            return recoverFromFailure(
                input.ledger,
                input.summary,
                [...input.ledger.failedEvidenceTools],
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
        return recoverFromFailure(input.ledger, input.summary, facts.failedToolNames);
    }

    return { action: "continue_tooling", reason: "tool_chain_allowed" };
}

function recoverFromRepeatedEvidence(
    ledger: AnswerCompletionLedger,
    toolNames: readonly string[],
): AnswerCompletionDecision {
    const attempts = ++ledger.repeatedEvidenceNoProgressCount;
    if (attempts >= 2) {
        return { action: "stop_incomplete", reason: "equivalent_no_progress", diagnostics: [{
            type: "equivalent_no_progress",
            message: "The assistant repeated already available evidence after a strategy change.",
            tools: [...new Set(toolNames)], attempts,
        }] };
    }
    return {
        action: "continue_recovery", reason: "strategy_change_required", toolMode: "normal",
        runtimeInstruction: [
            `${[...new Set(toolNames)].join(", ")} returned evidence already available in this run.`,
            "Do not read the same source again. The original task remains unfinished unless its requested fact is supported.",
            "If an admitted note names a linked source for the missing fact and that source is allowed, read that specific note now. Use scoped search only when no specific source is available.",
            "Otherwise answer only what the evidence supports and state what remains unresolved.",
        ].join(" "),
    };
}

function recoverFromFailure(
    ledger: AnswerCompletionLedger,
    summary: PaAgentTurnSummary,
    toolNames: readonly string[],
): AnswerCompletionDecision {
    const observations = summary.toolResults.filter((result) => isFailureOrStatusResult(result));
    const signature = JSON.stringify([ledger.progressEpoch, observations.map((result) => ({
        tool: result.toolName,
        outcome: result.content.metadata?.outcome ?? "unknown",
        executionState: result.content.metadata?.executionState ?? "unknown",
    })).sort((left, right) => `${left.tool}:${left.outcome}:${left.executionState}`
        .localeCompare(`${right.tool}:${right.outcome}:${right.executionState}`))]);
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
            case "tool_failure":
                return `${toolList} returned only unavailable, invalid, skipped, or status observations.`;
            case "duplicate_only":
                return `${toolList} has already been gathered or produced no new information.`;
            case "repeated_no_match":
                return `${toolList} returned repeated no-match observations in the permitted notes. State only what was searched; an unavailable Memory result does not prove that content is absent.`;
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
        ...(reason === "repeated_no_match" ? [
            "For a lookup, give a bounded not-found result. For a task requiring missing material, explain that it remains incomplete.",
        ] : []),
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

function hasPromptIncludedObservation(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    return result.content.includeInNextPrompt && result.content.promptText.trim().length > 0;
}

function isEmptyVaultNoMatch(result: PaAgentTurnSummary["toolResults"][number]): boolean {
    if (result.toolName !== "search_vault_snippets" || result.content.resultFact?.kind !== "no_match"
        || result.content.metadata?.vaultObservationContractVersion !== 1) return false;
    const parsed = parseVaultObservationEvidence(result.content.metadata.vaultObservationEvidence);
    return parsed.ok && parsed.evidence.tool === "search_vault_snippets"
        && parsed.evidence.coverage.state === "complete"
        && parsed.evidence.coverage.scannedPermittedNotes === 0
        && parsed.evidence.coverage.evaluatedCandidates === 0
        && parsed.evidence.items.length === 0;
}

function hasSuccessfulEvidence(
    result: PaAgentTurnSummary["toolResults"][number],
): boolean {
    const fact = result.content.resultFact;
    if (fact && fact.kind !== "evidence" && fact.kind !== "applied") return false;
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

function successfulObservationKeys(result: PaAgentTurnSummary["toolResults"][number], receipts: string[]): string[] {
    if (receipts.length > 0) return receipts;
    if (preparedWritingContextSelection(result) !== null) return [];
    // An unversioned success remains usable once for ordinary tool chaining,
    // but changing its prompt text cannot manufacture a new progress identity.
    return [`unverified:${result.toolName}`];
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
    const fact = result.content.resultFact;
    if (fact?.kind === "no_match" || fact?.kind === "approval_pending"
        || fact?.kind === "applied" || fact?.kind === "evidence") return false;
    if (fact?.kind === "unavailable" || fact?.kind === "transient_failure"
        || fact?.kind === "partial" || fact?.kind === "unknown") return true;
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
