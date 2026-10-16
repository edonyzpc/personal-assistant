import type { PaAgentHostPolicy, PaAgentTurnSummary } from "../../ai-services/pa-agent-loop";
import type { PageletInsightSourceSupportFailure } from "./pagelet-agent-quality-gate";
import { isPageletNoInsightTerminal } from "./types";

type TerminalProtocolFailure = "terminal-evidence" | "terminal-source-support" | "citation";
type TerminalSourceFailure = PageletInsightSourceSupportFailure | "ungrounded-path" | "missing-anchor";

interface PageletLeadDrivenPolicyOptions {
    validateTerminalSourceSupport: (
        body: string,
    ) => TerminalSourceFailure | null | PromiseLike<TerminalSourceFailure | null>;
}

/**
 * Mechanical terminal admission only. The Agent owns exploration, staging,
 * result size and stopping; source facts remain owned by the evidence boundary.
 */
export class PageletLeadDrivenPolicy implements PaAgentHostPolicy {
    private acceptedTerminalText: string | undefined;
    private protocolFailure: TerminalProtocolFailure | null = null;
    private correctionRequested = false;
    private emptyFinalizationRetryRequested = false;

    constructor(private readonly options: PageletLeadDrivenPolicyOptions) {}

    getEmptyFinalAnswerRetryCount(): 0 | 1 {
        return this.emptyFinalizationRetryRequested ? 1 : 0;
    }

    discardPendingOutput(): void {
        this.acceptedTerminalText = undefined;
    }

    async afterTurn(summary: PaAgentTurnSummary) {
        if (summary.status === "aborted" || summary.status === "error") {
            return { action: "stop" as const, status: summary.status, reason: summary.status };
        }
        if (summary.status === "completed_with_warning") {
            return { action: "stop" as const, status: "incomplete" as const, reason: "pagelet_terminal_incomplete" };
        }
        if (summary.status === "tool_results_ready") {
            return { action: "continue" as const, reason: "tool_results_ready" as const };
        }
        const terminalText = assistantTerminalText(summary);
        if (terminalText && summary.status === "completed") {
            const failure = isPageletNoInsightTerminal(terminalText)
                ? null
                : await this.options.validateTerminalSourceSupport(terminalText);
            if (failure) {
                this.protocolFailure = failure === "missing-content-tool"
                    ? "terminal-evidence"
                    : failure === "stale-source" ? "terminal-source-support" : "citation";
                if (failure === "stale-source" || this.correctionRequested
                    || summary.controlSnapshot?.toolMode === "final_answer_only") {
                    return this.stopForProtocolFailure();
                }
                this.correctionRequested = true;
                return {
                    action: "continue" as const,
                    reason: "corrective_turn" as const,
                    runtimeInstruction: [
                        "The submitted text is not grounded in the current source evidence.",
                        "Cite the exact permitted vault paths whose content actually reached you, including the frozen anchor.",
                        "A tool name, metadata or a path without source content is not content evidence.",
                        "You may read permitted source content or correct the text; return exactly NO_INSIGHT if you have no completed finding.",
                    ].join(" "),
                };
            }
            this.protocolFailure = null;
            this.acceptedTerminalText = isPageletNoInsightTerminal(terminalText) ? "NO_INSIGHT" : terminalText;
            return {
                action: "stop" as const,
                status: summary.status,
                reason: "final_text_ready",
            };
        }
        if (!terminalText && summary.status === "incomplete"
            && summary.toolCalls.length === 0 && summary.toolResults.length === 0
            && summary.diagnostics.some(diagnostic => diagnostic.type === "assistant_empty_response")) {
            if (this.emptyFinalizationRetryRequested) {
                return {
                    action: "stop" as const,
                    status: "incomplete" as const,
                    reason: "pagelet_empty_finalization_exhausted",
                    diagnostics: [{
                        type: "pagelet_empty_finalization_exhausted",
                        message: "The empty final response retry was also empty.",
                    }],
                };
            }
            this.emptyFinalizationRetryRequested = true;
            return {
                action: "continue" as const,
                reason: "corrective_turn" as const,
                runtimeInstruction: "The final response was empty. Return the completed source-backed Markdown, or exactly NO_INSIGHT if there is no completed finding.",
            };
        }
        return {
            action: "stop" as const,
            status: "incomplete" as const,
            reason: "pagelet_terminal_incomplete",
        };
    }

    resolveRunTerminal(): { finalText: string; protocolFailure: TerminalProtocolFailure | null } {
        return { finalText: this.acceptedTerminalText ?? "", protocolFailure: this.protocolFailure };
    }

    private stopForProtocolFailure() {
        return {
            action: "stop" as const,
            status: "incomplete" as const,
            reason: this.protocolFailure === "terminal-evidence"
                ? "pagelet_terminal_evidence_protocol_exhausted"
                : this.protocolFailure === "terminal-source-support"
                    ? "pagelet_terminal_source_support_exhausted"
                    : "pagelet_citation_protocol_exhausted",
        };
    }
}

function assistantTerminalText(summary: PaAgentTurnSummary): string {
    if (summary.assistantMessage.role !== "assistant") return "";
    return summary.assistantMessage.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map(part => part.text)
        .join("");
}
