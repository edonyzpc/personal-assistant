import { createAgentControlSnapshot, type AgentControlSnapshot } from "../pa-agent-control-policy";
import type { PaAgentTurnSummary } from "../pa-agent-loop";
import { CORE_WRITE_TOOL_NAMES } from "./types";

export const OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION = [
    "The current user's Operations proposal was staged successfully in the inline confirmation card, and nothing has been written yet.",
    "Reply only with a concise acknowledgement that this current proposal is ready for review.",
    "Do not mention internal turns, tool availability, or the state or content of any earlier proposal.",
    "Do not call tools or claim that a write has completed.",
].join(" ");

export function isOperationsStagedAcknowledgement(runtimeInstruction?: string): boolean {
    return runtimeInstruction === OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION;
}

export function hasOperationsStagedAcknowledgementInstruction(runtimeInstruction?: string): boolean {
    return runtimeInstruction?.includes(OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION) === true;
}

export function hasStagedOperationsIntent(summary: Pick<PaAgentTurnSummary, "toolResults">): boolean {
    return summary.toolResults.some(result => CORE_WRITE_TOOL_NAMES.some(name => name === result.toolName)
        && !result.isError && result.content.resultFact?.kind === "approval_pending"
        && result.content.resultFact.intentId.length > 0);
}

export function createOperationsAcknowledgementControlSnapshot(previous?: AgentControlSnapshot): AgentControlSnapshot {
    return createAgentControlSnapshot({
        exposureMode: "answer-ready",
        sourceScope: previous?.sourceScope ?? "none",
        allowedToolNames: new Set(),
        ...(previous?.blockedToolNames ? { blockedToolNames: previous.blockedToolNames } : {}),
        ...(previous ? { blockedReasons: previous.blockedReasons } : {}),
        runtimeInstruction: OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
        toolMode: "normal",
        ...(previous ? { budgetState: previous.budgetState } : {}),
        diagnostics: [
            ...(previous?.diagnostics ?? []),
            { type: "operations_intent_staged_acknowledgement",
                message: "Operations proposal is staged; the next turn may only acknowledge the inline confirmation card." },
        ],
    });
}
