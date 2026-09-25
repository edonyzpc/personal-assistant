import type {
    PaAgentHostPolicy,
    PaAgentTerminalDecision,
    PaAgentTerminalPolicyContext,
    PaAgentTurnSummary,
} from "./pa-agent-loop";
import {
    createAnswerCompletionLedger,
    decideAnswerCompletion,
    deriveAnswerCompletionTurnFacts,
    recordAnswerCompletionTurn,
    synchronizeProjectedMemoryCompletion,
    type AnswerCompletionLedger,
} from "./pa-agent-answer-completion-policy";
import {
    deriveAnswerReadyAgentControlSnapshot,
    deriveSameSourceFollowUpAgentControlSnapshot,
} from "./pa-agent-control-policy";
import type { PaAgentMessage } from "./chat-types";

// These Type A preparation helpers remain available to older direct callers.
export { isExplicitCurrentNoteOnlyRequest, isExplicitNoWebRequest, shouldUseFullCurrentNoteContext }
    from "./chat-tool-prepare-helpers";

interface CompletionState {
    ledger: AnswerCompletionLedger;
    allowWritingContextSchemaRepair: boolean;
    writingContextSchemaRepairAttempted: boolean;
    allowManagedActionAfterDuplicateNoteRead: boolean;
    managedActionDuplicateRecoveryAttempted: boolean;
    terminal?: PaAgentTerminalDecision;
}

/** Host completion uses actual tool results and domain facts, not predicted tool requirements. */
export function createRequiredCapabilityHostPolicy(options: {
    allowWritingContextSchemaRepair?: boolean;
    allowManagedActionAfterDuplicateNoteRead?: boolean;
} = {}): {
    hostPolicy: PaAgentHostPolicy;
    synchronizeProjectedTranscript(transcript: readonly PaAgentMessage[]): void;
} {
    const state: CompletionState = {
        ledger: createAnswerCompletionLedger(),
        allowWritingContextSchemaRepair: options.allowWritingContextSchemaRepair === true,
        writingContextSchemaRepairAttempted: false,
        allowManagedActionAfterDuplicateNoteRead: options.allowManagedActionAfterDuplicateNoteRead === true,
        managedActionDuplicateRecoveryAttempted: false,
    };
    return {
        hostPolicy: {
            afterTurn: summary => decideAfterTurn(summary, state),
            finalizeAfterTurn: (summary, context) => decideTerminalAfterTurn(summary, state, context),
        },
        synchronizeProjectedTranscript: transcript => synchronizeProjectedMemoryCompletion(state.ledger, transcript),
    };
}

function decideAfterTurn(summary: PaAgentTurnSummary, state: CompletionState): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    if (state.terminal) return state.terminal;
    const facts = deriveAnswerCompletionTurnFacts(summary, state.ledger);
    const priorAppliedInsightActions = state.ledger.appliedInsightActionReceipts.length;
    recordAnswerCompletionTurn(state.ledger, summary, facts);

    if (!facts.hasFinalText && state.ledger.appliedInsightActionReceipts.length > priorAppliedInsightActions) {
        return {
            action: "continue", reason: "needs_follow_up",
            runtimeInstruction: `The host has already applied this Saved Insight action: ${state.ledger.appliedInsightActionReceipts.at(-1)}. Report the actual result now. Do not repeat the same action or source reads; a later turn having no new tools does not undo this completed action.`,
        };
    }

    const observations = summary.toolResults;
    if (state.allowWritingContextSchemaRepair && !state.writingContextSchemaRepairAttempted
        && summary.status === "tool_results_ready" && observations.length > 0
        && observations.every(result => result.toolName === "get_writing_context" && result.isError
            && result.content.metadata?.outcome === "schema_invalid")) {
        state.writingContextSchemaRepairAttempted = true;
        return { action: "continue", reason: "tool_results_ready", runtimeInstruction:
            "The writing context was not prepared because its arguments failed schema validation. You may correct the arguments once using the existing allowed tools and source scope. When known, scene must be an object with writingTask, purpose, audience and domain; omit scene when unknown, never use a JSON-encoded string. Wait for a successful context result before presenting a work." };
    }

    if (state.allowManagedActionAfterDuplicateNoteRead
        && !state.managedActionDuplicateRecoveryAttempted
        && facts.hasOnlyDuplicateOrNoopResults
        && facts.duplicateOrNoopToolNames.length > 0
        && facts.duplicateOrNoopToolNames.every(name => name === "read_note")
        && state.ledger.successfulEvidenceTools.has("read_note")) {
        state.managedActionDuplicateRecoveryAttempted = true;
        return { action: "continue", reason: "needs_follow_up",
            runtimeInstruction: "The requested note content and source versions were already gathered in this run. Do not reread those notes. If the current user explicitly requested a bound managed action, call that action now using the existing source observations; otherwise answer from the evidence. Do not claim an action succeeded without its actual result." };
    }

    const completion = decideAnswerCompletion({ summary, ledger: state.ledger, facts });
    if (completion?.action === "force_finalize" || completion?.action === "continue_recovery") {
        return { action: "continue", reason: "needs_follow_up",
            runtimeInstruction: completion.runtimeInstruction, toolMode: completion.toolMode };
    }
    if (completion?.action === "continue_tooling" && shouldOpenSameSourceFollowUp(summary)) {
        return buildSameSourceFollowUpDecision(summary);
    }
    if (completion?.action === "continue_tooling" && facts.hasPromptIncludedObservation) {
        return buildAnswerReadyDecision(summary, completion.reason);
    }
    if (completion?.action === "stop_incomplete") {
        state.terminal = { action: "stop", reason: completion.reason, status: "incomplete",
            diagnostics: completion.diagnostics };
        return state.terminal;
    }
    if (summary.status === "tool_results_ready") return { action: "continue", reason: "tool_results_ready" };
    state.terminal = { action: "stop", reason: summary.status, status: mapTerminalStatus(summary.status) };
    return state.terminal;
}

function decideTerminalAfterTurn(
    summary: PaAgentTurnSummary, state: CompletionState, context: PaAgentTerminalPolicyContext,
): PaAgentTerminalDecision {
    if (state.terminal) return state.terminal;
    for (const turn of context.unobservedTurnSummary ? [context.unobservedTurnSummary, summary] : [summary]) {
        const facts = deriveAnswerCompletionTurnFacts(turn, state.ledger);
        recordAnswerCompletionTurn(state.ledger, turn, facts);
    }
    state.terminal = { action: "stop", status: context.defaultStatus, reason: context.reason };
    return state.terminal;
}

function buildAnswerReadyDecision(
    summary: PaAgentTurnSummary,
    reason: "new_tool_evidence" | "tool_chain_allowed" | "normal_no_match",
): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const runtimeInstruction = [
        reason === "new_tool_evidence" ? "Tool observations are now available."
            : "Tool observations or status information are now available.",
        "Answer directly if the existing observations are sufficient.",
        "Call another allowed tool only when a specific missing fact is needed; do not repeat an identical source/query.",
    ].join(" ");
    return { action: "continue", reason: "tool_results_ready", runtimeInstruction,
        controlSnapshot: deriveAnswerReadyAgentControlSnapshot(summary.controlSnapshot, {
            runtimeInstruction,
            diagnostics: [{ type: "answer_ready_decision",
                message: "Host policy marked the next turn as answer-ready after useful tool observations.",
                metadata: { reason } }],
        }) };
}

function shouldOpenSameSourceFollowUp(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.some(result => result.toolName === "search_memory" && !result.isError
        && result.content.includeInNextPrompt
        && (result.content.metadata?.needsSnippetFollowup === true
            || result.content.metadata?.needsFollowup === true));
}

function buildSameSourceFollowUpDecision(summary: PaAgentTurnSummary): ReturnType<PaAgentHostPolicy["afterTurn"]> {
    const runtimeInstruction = [
        "The Memory result indicates that a targeted note follow-up may be useful.",
        "Use one allowed notes follow-up tool only if it resolves a specific missing fact; otherwise answer from the existing observations.",
    ].join(" ");
    return { action: "continue", reason: "needs_follow_up", runtimeInstruction,
        controlSnapshot: deriveSameSourceFollowUpAgentControlSnapshot(summary.controlSnapshot, {
            sourceScope: "notes", runtimeInstruction,
            diagnostics: [{ type: "same_source_follow_up_decision",
                message: "Host policy opened notes follow-up tools because Memory requested snippet follow-up." }],
        }) };
}

function mapTerminalStatus(status: PaAgentTurnSummary["status"]): PaAgentTerminalDecision["status"] {
    if (status === "completed_with_warning") return "completed_with_warning";
    if (status === "aborted") return "aborted";
    if (status === "error") return "error";
    if (status === "incomplete") return "incomplete";
    return "completed";
}
