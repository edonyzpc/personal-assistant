/** Closed, source-free text shared by the tool and its history admission readers. */
export const GHOST_PREPARATION_MESSAGES = {
    prepared: "A draft or update preview is saved. Open its publishing card to review and choose the human publishing action.",
    outcome_unknown: "The preparation result needs verification in its publishing card. Do not repeat the request or claim it is published.",
    saved_attention: "The Ghost content was saved, but a follow-up step needs attention. Use the saved article shown in the card; do not create another draft.",
    failed_attention: "Preparation did not finish. Read the publishing card for the specific failure and advice; publication has not been confirmed.",
} as const;

export function ghostPreparationMessage(status: unknown, executionState: unknown): string | undefined {
    if (status === "prepared" && executionState === "succeeded") return GHOST_PREPARATION_MESSAGES.prepared;
    if (status === "outcome_unknown" && executionState === "acceptance_unknown") return GHOST_PREPARATION_MESSAGES.outcome_unknown;
    if (status === "needs_attention") {
        if (executionState === "succeeded") return GHOST_PREPARATION_MESSAGES.saved_attention;
        if (executionState === "not_started" || executionState === "failed") return GHOST_PREPARATION_MESSAGES.failed_attention;
    }
    return undefined;
}
