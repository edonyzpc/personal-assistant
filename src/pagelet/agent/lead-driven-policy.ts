import type {
    PaAgentHostPolicy,
    PaAgentTurnSummary,
} from "../../ai-services/pa-agent-loop";
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from "../../ai-services/builtin-web-search-provider";
import {
    createAgentControlSnapshot,
    type AgentControlSnapshot,
} from "../../ai-services/pa-agent-control-policy";

const VAULT_LEAD_TOOL_NAMES = new Set([
    "search_memory",
    "get_current_note_context",
    "search_vault_snippets",
    "inspect_obsidian_note",
    "read_note_outline",
    "search_vault_metadata",
    "list_recent_notes",
]);

const CONTENT_EVIDENCE_TOOL_NAMES = new Set([
    "get_current_note_context",
    "search_vault_snippets",
    "inspect_obsidian_note",
    "read_note_outline",
]);

interface PageletLeadDrivenPolicyOptions {
    anchorPath: string;
    maxTurns: number;
    maxToolCalls: number;
    maxWallClockMs: number;
    now: () => number;
    startedAt: number;
    finalizationReserveMs?: number;
}

export class PageletLeadDrivenPolicy implements PaAgentHostPolicy {
    private finalizationRequested = false;
    private webLeadCorrectionRequested = false;
    private recoverableVaultCorrectionRequested = false;
    private anchorRead = false;
    private readonly nonAnchorContentPaths = new Set<string>();
    private executedToolCalls = 0;

    constructor(private readonly options: PageletLeadDrivenPolicyOptions) {}

    afterTurn(summary: PaAgentTurnSummary) {
        this.executedToolCalls += summary.timing.executorInvokedToolNames?.length ?? 0;
        this.recordContentEvidence(summary);

        if (summary.committedFinalText.trim()) {
            return {
                action: "stop" as const,
                status: summary.status === "completed_with_warning"
                    ? "completed_with_warning" as const
                    : "completed" as const,
                reason: "final_text_ready",
            };
        }

        if (summary.status === "tool_results_ready") {
            if (this.shouldReserveFinalization(summary)) {
                return this.requestFinalization(
                    "The emergency run fuse is near. Do not open another exploration branch.",
                );
            }
            const successfulResult = summary.toolResults.some((result) => (
                !result.isError && result.content.includeInNextPrompt
            ));
            if (successfulResult) {
                const unlockedControlSnapshot = hasVaultLeadObservation(summary)
                    ? unlockVerificationOnlyWeb(summary.controlSnapshot)
                    : undefined;
                return {
                    action: "continue" as const,
                    reason: "tool_results_ready" as const,
                    runtimeInstruction: this.buildContinuationInstruction(summary),
                    ...(unlockedControlSnapshot
                        ? { controlSnapshot: unlockedControlSnapshot }
                        : {}),
                };
            }
            if (
                !this.webLeadCorrectionRequested
                && webSearchWasBlockedBeforeVaultLead(summary)
            ) {
                this.webLeadCorrectionRequested = true;
                return {
                    action: "continue" as const,
                    reason: "corrective_turn" as const,
                    runtimeInstruction: [
                        "WebSearch is verification-only and is not available yet.",
                        "Read the frozen anchor and follow a vault lead first.",
                    ].join(" "),
                };
            }
            if (
                !this.recoverableVaultCorrectionRequested
                && onlyCorrectableNonWebFailures(summary)
            ) {
                this.recoverableVaultCorrectionRequested = true;
                return {
                    action: "continue" as const,
                    reason: "corrective_turn" as const,
                    runtimeInstruction: [
                        "A vault tool batch failed with correctable input or runtime errors and produced no usable evidence.",
                        "Make one corrected read-only attempt: read the frozen anchor first, then follow only one exact vault lead.",
                        "Do not use WebSearch until a successful vault observation unlocks it.",
                    ].join(" "),
                };
            }
            return this.requestFinalization("All attempted tools were unavailable or rejected.");
        }

        if (summary.status === "aborted" || summary.status === "error") {
            return {
                action: "stop" as const,
                status: summary.status,
                reason: summary.status,
            };
        }

        return this.requestFinalization("Finish from the available evidence.");
    }

    private recordContentEvidence(summary: PaAgentTurnSummary): void {
        for (const result of summary.toolResults) {
            if (
                result.isError
                || !result.content.includeInNextPrompt
                || !CONTENT_EVIDENCE_TOOL_NAMES.has(result.toolName)
            ) {
                continue;
            }
            for (const record of result.content.sourceRecords ?? []) {
                const path = record.path;
                if (!path) continue;
                if (
                    result.toolName === "get_current_note_context"
                    && path === this.options.anchorPath
                ) {
                    this.anchorRead = true;
                } else if (path !== this.options.anchorPath) {
                    this.nonAnchorContentPaths.add(path);
                }
            }
        }
    }

    private shouldReserveFinalization(summary: PaAgentTurnSummary): boolean {
        const finalTurnIsNext = summary.turnIndex >= this.options.maxTurns - 2;
        const toolBudgetExhausted = this.executedToolCalls >= this.options.maxToolCalls;
        const reserveMs = this.options.finalizationReserveMs ?? 30_000;
        const elapsedMs = Math.max(0, this.options.now() - this.options.startedAt);
        const wallClockReserveReached = (
            this.options.maxWallClockMs - elapsedMs
        ) <= reserveMs;
        return finalTurnIsNext || toolBudgetExhausted || wallClockReserveReached;
    }

    private buildContinuationInstruction(summary: PaAgentTurnSummary): string {
        const turnsUsed = summary.turnIndex + 1;
        const answerReady = this.anchorRead && this.nonAnchorContentPaths.size > 0;
        return [
            "Continue only from the strongest evidence-backed lead.",
            "The normal target is 3–5 model turns and 8–12 real tool calls; 30 calls and 180 seconds are emergency fuses, not exploration targets.",
            answerReady
                ? "The anchor and at least one non-anchor content source are already observed. If they support one worthwhile contradiction, evolution, gap, risk, or implication, finalize now; otherwise make only the smallest tool batch needed to resolve one specific gap."
                : "First establish the frozen anchor plus at least one non-anchor content source; search or metadata leads alone are not final evidence.",
            turnsUsed >= 3 || this.executedToolCalls >= 8
                ? "The normal exploration range has begun: do not broaden into a new branch without a specific unresolved contradiction."
                : "When independent paths are already known, read them together in one tool turn.",
            this.citationInstruction(),
            "If the evidence does not clear the usefulness bar, finish with exactly NO_INSIGHT.",
        ].join(" ");
    }

    private citationInstruction(): string {
        return [
            "Cite only exact vault paths returned by successful content-reading tools,",
            "format every cited path as inline code, and never mention an unverified .md path.",
        ].join(" ");
    }

    private requestFinalization(runtimeInstruction: string) {
        if (this.finalizationRequested) {
            return {
                action: "stop" as const,
                status: "incomplete" as const,
                reason: "finalization_exhausted",
            };
        }
        this.finalizationRequested = true;
        return {
            action: "continue" as const,
            reason: "corrective_turn" as const,
            toolMode: "final_answer_only" as const,
            runtimeInstruction: [
                runtimeInstruction,
                "Return the strongest source-grounded Markdown finding now.",
                this.citationInstruction(),
                "If none is adequately supported, return exactly NO_INSIGHT.",
            ].join(" "),
        };
    }
}

function hasVaultLeadObservation(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.some((result) => (
        !result.isError
        && VAULT_LEAD_TOOL_NAMES.has(result.toolName)
        && result.content.includeInNextPrompt
        && result.content.promptText.trim().length > 0
        && (result.content.sourceRecords ?? []).some((record) => Boolean(record.path))
    ));
}

function webSearchWasBlockedBeforeVaultLead(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.some((result) => (
        result.toolName === BUILTIN_WEB_SEARCH_TOOL_NAME
        && result.isError
        && result.content.metadata?.reason === "control_snapshot_tool_blocked"
    ));
}

function onlyCorrectableNonWebFailures(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.length > 0
        && summary.toolResults.every((result) => (
            result.isError
            && result.toolName !== BUILTIN_WEB_SEARCH_TOOL_NAME
            && (
                result.content.metadata?.outcome === "recoverable_error"
                || result.content.metadata?.outcome === "schema_invalid"
            )
        ));
}

function unlockVerificationOnlyWeb(
    snapshot: AgentControlSnapshot | undefined,
): AgentControlSnapshot | undefined {
    if (!snapshot?.blockedToolNames?.has(BUILTIN_WEB_SEARCH_TOOL_NAME)) return undefined;
    const blockedToolNames = new Set(snapshot.blockedToolNames);
    blockedToolNames.delete(BUILTIN_WEB_SEARCH_TOOL_NAME);
    const blockedReasons = { ...snapshot.blockedReasons };
    delete blockedReasons[BUILTIN_WEB_SEARCH_TOOL_NAME];
    return createAgentControlSnapshot({
        exposureMode: snapshot.exposureMode,
        sourceScope: snapshot.sourceScope,
        ...(snapshot.allowedToolNames
            ? { allowedToolNames: snapshot.allowedToolNames }
            : {}),
        ...(blockedToolNames.size > 0 ? { blockedToolNames } : {}),
        blockedReasons,
        ...(snapshot.runtimeInstruction
            ? { runtimeInstruction: snapshot.runtimeInstruction }
            : {}),
        ...(snapshot.toolMode ? { toolMode: snapshot.toolMode } : {}),
        budgetState: snapshot.budgetState,
        diagnostics: [
            ...snapshot.diagnostics,
            {
                type: "pagelet_web_unlocked_after_vault_lead",
                message: "WebSearch is now available only to verify the established vault lead.",
            },
        ],
    });
}
