import type {
    PaAgentHostPolicy,
    PaAgentTurnSummary,
} from "../../ai-services/pa-agent-loop";
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from "../../ai-services/builtin-web-search-provider";
import {
    createAgentControlSnapshot,
    type AgentControlSnapshot,
} from "../../ai-services/pa-agent-control-policy";
import type {
    ChatToolUnavailableReason,
    PaAgentMessage,
} from "../../ai-services/chat-types";
import { resolvePageletInsightSourcePaths } from "./pagelet-agent-quality-gate";
import { PAGELET_STAGE_INSIGHT_TOOL_NAME } from "./pagelet-recovery-coordinator";
import { isPageletNoInsightTerminal } from "./types";

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

const MAX_EXACT_LEAD_IDENTIFIERS = 4;
const EXACT_LEAD_IDENTIFIER_PATTERN = /(^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,15}(?:[-_:][A-Za-z0-9]{1,24}){1,4})(?=$|[^A-Za-z0-9])/g;
const KNOWN_EXACT_LEAD_PREFIXES = new Set([
    "bug",
    "case",
    "err",
    "error",
    "inc",
    "incident",
    "issue",
    "proj",
    "project",
    "task",
    "ticket",
]);
const UNRESOLVED_CONTEXT_PATTERN = /\b(?:blocked|failed|failing|investigat(?:e|ing|ion)|missing|needs?\s+(?:investigation|verification)|pending|requires?\s+(?:investigation|verification)|root\s+cause|still\s+open|remains?\s+open|todo|unexplained|unknown|unresolved|why)\b|为什么|原因待查|尚未解释|待处理|待查|待解决|待确认|未解决|需核查|需要核查|阻塞|失败|缺失|未知/gi;
const RESOLVED_CONTEXT_PATTERN = /\b(?:closed|completed|done|explained|fixed|investigated|no\s+longer\s+unresolved|resolved|verified)\b|原因已查明|已关闭|已完成|已解释|已解决|已核查|已修复/gi;
const EXACT_LEAD_CONTEXT_BOUNDARY_PATTERN = /[\n\r.!?;。！？；]/;
const MAX_EXACT_LEAD_CUE_DISTANCE = 80;

export function extractPageletExactIdentifiers(content: string): string[] {
    const identifiers: string[] = [];
    const seen = new Set<string>();
    for (const match of content.matchAll(EXACT_LEAD_IDENTIFIER_PATTERN)) {
        const literal = match[2];
        const literalIndex = (match.index ?? 0) + (match[1]?.length ?? 0);
        if (
            !literal
            || literal.length > 72
            || !isDistinctExactIdentifier(literal)
            || !hasUnresolvedContext(content, literalIndex, literal.length)
        ) continue;
        if (seen.has(literal)) continue;
        seen.add(literal);
        identifiers.push(literal);
        if (identifiers.length >= MAX_EXACT_LEAD_IDENTIFIERS) break;
    }
    return identifiers;
}

interface PageletLeadDrivenPolicyOptions {
    anchorPath: string;
    anchorContent?: string;
    maxTurns: number;
    maxToolCalls: number;
    maxWallClockMs: number;
    now: () => number;
    startedAt: number;
    finalizationReserveMs?: number;
    hasStagedInsight?: () => boolean;
    canStageInsight?: boolean;
}

export class PageletLeadDrivenPolicy implements PaAgentHostPolicy {
    private finalizationRequested = false;
    private webLeadCorrectionRequested = false;
    private recoverableVaultCorrectionRequested = false;
    private anchorRead = false;
    private readonly nonAnchorContentPaths = new Set<string>();
    private readonly nonAnchorContentTurnByPath = new Map<string, number>();
    private exactSearchCompleted = false;
    private exactSearchReturnedCandidates = false;
    private readonly exactCandidateTurnByPath = new Map<string, number>();
    private readonly exactSearchTurnByToolCallId = new Map<string, number>();
    private exactLeadDuplicateCorrectionRequested = false;
    private exactLeadTerminalViolations = 0;
    private exactLeadProtocolExhausted = false;
    private citationCorrectionRequested = false;
    private stageShapeCorrectionRequested = false;
    private stageShapeProtocolExhausted = false;
    private multiLeadEvaluationRequested = false;
    private preservedFirstTerminalText: string | undefined;
    private acceptedTerminalText: string | undefined;
    private readonly processedTurnIds = new Set<string>();
    private readonly anchorExactIdentifiers: readonly string[];
    private readonly contentPathsByAnchorIdentifier = new Map<string, Set<string>>();
    private readonly requiredExactIdentifier: string | undefined;
    private executedToolCalls = 0;

    constructor(private readonly options: PageletLeadDrivenPolicyOptions) {
        this.anchorExactIdentifiers = extractPageletExactIdentifiers(
            options.anchorContent ?? "",
        );
        this.requiredExactIdentifier = this.anchorExactIdentifiers[0];
    }

    afterTurn(summary: PaAgentTurnSummary) {
        this.processedTurnIds.add(summary.turnId);
        this.executedToolCalls += summary.timing.executorInvokedToolNames?.length ?? 0;
        this.recordContentEvidence(summary);
        this.recordExactSearchEvidence(summary);
        const stageValidationFailure = getStageValidationFailureReason(summary);
        if (
            this.stageShapeCorrectionRequested
            && this.options.hasStagedInsight?.() !== true
            && stageValidationFailure === undefined
        ) {
            this.stageShapeProtocolExhausted = true;
            return stageShapeProtocolIncompleteDecision();
        }

        const terminalText = assistantTerminalText(summary);
        if (terminalText) {
            const noInsightTerminal = isPageletNoInsightTerminal(terminalText);
            if (!noInsightTerminal && this.hasUngroundedTerminalCitation(terminalText)) {
                return this.requestCitationCorrection(summary);
            }
            if (noInsightTerminal && !this.isExactLeadProtocolSatisfied()) {
                return this.handleExactLeadProtocolViolation(summary);
            }
            if (!noInsightTerminal && this.shouldVerifyCandidateBeforeTerminal()) {
                return this.handleUnverifiedCandidateTerminal(summary);
            }
            if (
                !noInsightTerminal
                && this.shouldEvaluateSourceCompleteSecondLead(summary)
            ) {
                this.multiLeadEvaluationRequested = true;
                this.preservedFirstTerminalText = terminalText;
                return {
                    action: "continue" as const,
                    reason: "corrective_turn" as const,
                    runtimeInstruction: [
                        "The frozen anchor names at least two concrete independent leads, and distinct current non-anchor sources for both leads have already been read.",
                        "Do not stop after the first finding and do not call another discovery or search tool.",
                        "Evaluate only those already-read leads against the same grounding, currentness, distinctness, novelty, and value gates.",
                        "If the current finding clears those gates, call stage_pagelet_insight once with that finding and its own sourceIds; use the already-read distinct lead evidence as supportingSourceIds and set requestRelaxedRecovery=false.",
                        "After staging, return only a distinct worthwhile second finding, or exactly NO_INSIGHT if the second is unsupported, a rewrite, or adds no value; the staged first remains valid.",
                        this.citationInstruction(),
                    ].join(" "),
                };
            }
            this.acceptedTerminalText = this.preservedFirstTerminalText !== undefined
                && this.options.hasStagedInsight?.() !== true
                ? this.preservedFirstTerminalText
                : noInsightTerminal
                    ? "NO_INSIGHT"
                    : terminalText;
            return {
                action: "stop" as const,
                status: summary.status === "completed_with_warning"
                    ? "completed_with_warning" as const
                    : "completed" as const,
                reason: "final_text_ready",
            };
        }

        if (
            this.citationCorrectionRequested
            && summary.controlSnapshot?.toolMode === "final_answer_only"
        ) {
            return citationProtocolIncompleteDecision();
        }
        if (summary.status === "tool_results_ready") {
            if (
                onlyStageShapeValidationFailures(summary)
                && this.options.canStageInsight === true
                && this.options.hasStagedInsight?.() !== true
                && this.hasDistinctSourceCompleteAnchorLeads()
            ) {
                return this.requestStageShapeCorrection(summary);
            }
            if (stageValidationFailure) {
                if (stageValidationFailure !== "pagelet_stage_lead_rejected") {
                    this.preservedFirstTerminalText = undefined;
                }
                return stageValidationFailureDecision(stageValidationFailure);
            }
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
                    runtimeInstruction: summary.toolResults.some((result) => (
                        result.toolName === PAGELET_STAGE_INSIGHT_TOOL_NAME && !result.isError
                    ))
                        ? [
                            "The first insight is pinned and must not be repeated or combined into the terminal text.",
                            "Use only the returned recovery evidence or the smallest ordinary read needed for the concrete lead.",
                            "On the next evidence-complete turn, return one distinct second natural-Markdown insight or exactly NO_INSIGHT.",
                            "Do not broaden merely to fill a second slot.",
                            this.citationInstruction(),
                        ].join(" ")
                        : this.buildContinuationInstruction(summary),
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
            if (this.shouldCorrectExactLeadAfterDuplicate(summary)) {
                if (this.exactLeadDuplicateCorrectionRequested) {
                    this.exactLeadProtocolExhausted = true;
                    return exactLeadProtocolIncompleteDecision(
                        "pagelet_exact_lead_duplicate_exhausted",
                    );
                }
                this.exactLeadDuplicateCorrectionRequested = true;
                return {
                    action: "continue" as const,
                    reason: "corrective_turn" as const,
                    runtimeInstruction: [
                        "The previous turn produced only duplicate tool status and no new evidence.",
                        `This is the one bounded tool-enabled corrective turn: call search_memory with exactly "${this.requiredExactIdentifier}"; do not call get_current_note_context again and do not broaden, split, or paraphrase the identifier.`,
                        "If the search returns a visible non-anchor candidate, verify that same path with a content-reading tool on a later turn before returning NO_INSIGHT.",
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

    isExactLeadProtocolSatisfied(): boolean {
        if (!this.requiredExactIdentifier) return true;
        if (this.hasContentReadForAnchorIdentifier(this.requiredExactIdentifier)) return true;
        if (!this.exactSearchCompleted) return false;
        if (!this.exactSearchReturnedCandidates) return true;
        if (this.exactCandidateTurnByPath.size === 0) return false;
        return [...this.exactCandidateTurnByPath].some(([path, searchTurnIndex]) => (
            (this.nonAnchorContentTurnByPath.get(path) ?? -1) > searchTurnIndex
        ));
    }

    reconcileMemoryCurrentness(transcript: readonly PaAgentMessage[]): void {
        if (!this.requiredExactIdentifier) return;
        this.exactSearchCompleted = false;
        this.exactSearchReturnedCandidates = false;
        this.exactCandidateTurnByPath.clear();
        for (const message of transcript) {
            if (
                message.role !== "toolResult"
                || message.toolName !== "search_memory"
                || message.isError
                || !message.content.includeInNextPrompt
                || String(message.content.metadata?.inputSummary ?? "").trim()
                    !== this.requiredExactIdentifier
            ) continue;
            const turnIndex = this.exactSearchTurnByToolCallId.get(message.toolCallId);
            if (turnIndex === undefined) continue;
            this.applyCurrentExactSearchObservation(message.content, turnIndex);
        }
    }

    resolveRunTerminal(lastTurn: PaAgentTurnSummary | undefined): {
        finalText: string;
        protocolFailure: boolean;
    } {
        if (this.stageShapeProtocolExhausted) {
            return { finalText: "", protocolFailure: true };
        }
        if (this.acceptedTerminalText !== undefined) {
            if (
                isPageletNoInsightTerminal(this.acceptedTerminalText)
                && !this.isExactLeadProtocolSatisfied()
            ) {
                return { finalText: "", protocolFailure: true };
            }
            return { finalText: this.acceptedTerminalText, protocolFailure: false };
        }
        if (
            this.preservedFirstTerminalText !== undefined
            && this.options.hasStagedInsight?.() !== true
        ) {
            return {
                finalText: this.preservedFirstTerminalText,
                protocolFailure: false,
            };
        }
        if (lastTurn && !this.processedTurnIds.has(lastTurn.turnId)) {
            const terminalText = assistantTerminalText(lastTurn);
            if (terminalText) {
                if (
                    !isPageletNoInsightTerminal(terminalText)
                    && this.hasUngroundedTerminalCitation(terminalText)
                ) {
                    return { finalText: "", protocolFailure: true };
                }
                if (
                    isPageletNoInsightTerminal(terminalText)
                    && !this.isExactLeadProtocolSatisfied()
                ) {
                    return { finalText: "", protocolFailure: true };
                }
                return {
                    finalText: isPageletNoInsightTerminal(terminalText)
                        ? "NO_INSIGHT"
                        : terminalText,
                    protocolFailure: false,
                };
            }
        }
        return {
            finalText: "",
            protocolFailure: this.stageShapeProtocolExhausted
                || this.exactLeadProtocolExhausted
                || this.exactLeadTerminalViolations > 0,
        };
    }

    private requestStageShapeCorrection(summary: PaAgentTurnSummary) {
        if (
            this.stageShapeCorrectionRequested
            || this.shouldReserveFinalization(summary)
        ) {
            this.stageShapeProtocolExhausted = true;
            return stageShapeProtocolIncompleteDecision();
        }
        this.stageShapeCorrectionRequested = true;
        const exactContentPaths = this.contentReadCitationPaths();
        const firstResolution = this.preservedFirstTerminalText
            ? resolvePageletInsightSourcePaths(
                this.preservedFirstTerminalText,
                exactContentPaths,
            )
            : { paths: [], hasUngroundedPath: false };
        const firstSourceIds = firstResolution.hasUngroundedPath
            ? []
            : firstResolution.paths;
        const firstSourceSet = new Set(firstSourceIds);
        const supportingCandidates = exactContentPaths.filter((path) => (
            path !== this.options.anchorPath && !firstSourceSet.has(path)
        ));
        const runtimeInstruction = [
            "The stage_pagelet_insight call failed input validation; do not re-read the anchor or call another discovery tool.",
            "This is the one stage-shape corrective turn. Call only stage_pagelet_insight once with the same complete first insightMarkdown.",
            `sourceIds must contain 2–16 unique exact paths, include the frozen anchor ${JSON.stringify(this.options.anchorPath)}, and equal the paths cited by the first insight.`,
            firstSourceIds.length > 0
                ? `The first finding currently resolves to these exact sourceIds: ${JSON.stringify(firstSourceIds)}.`
                : `Choose sourceIds only from these successful content-read paths: ${JSON.stringify(exactContentPaths)}.`,
            `unresolvedLead.supportingSourceIds must contain 1–16 unique exact non-anchor paths from successful content reads that support the distinct lead; current candidates are ${JSON.stringify(supportingCandidates)}.`,
            "Keep leadKey concrete and set requestRelaxedRecovery=false when the already-read evidence completes the second finding.",
            "Do not use basenames, metadata/search-only paths, duplicate paths, or the anchor as a supportingSourceId.",
        ].join(" ");
        const base = summary.controlSnapshot ?? createAgentControlSnapshot();
        return {
            action: "continue" as const,
            reason: "corrective_turn" as const,
            runtimeInstruction,
            controlSnapshot: createAgentControlSnapshot({
                exposureMode: "narrowed-required",
                sourceScope: base.sourceScope,
                allowedToolNames: new Set([PAGELET_STAGE_INSIGHT_TOOL_NAME]),
                ...(base.blockedToolNames
                    ? { blockedToolNames: base.blockedToolNames }
                    : {}),
                blockedReasons: base.blockedReasons,
                runtimeInstruction,
                budgetState: base.budgetState,
                diagnostics: [
                    ...base.diagnostics,
                    {
                        type: "pagelet_stage_shape_correction",
                        message: "Only the Pagelet staging control is exposed for one corrected shape attempt.",
                    },
                ],
            }),
        };
    }

    private hasUngroundedTerminalCitation(terminalText: string): boolean {
        const resolution = resolvePageletInsightSourcePaths(
            terminalText,
            this.contentReadCitationPaths(),
        );
        return this.nonAnchorContentPaths.size > 0 && resolution.hasUngroundedPath;
    }

    private requestCitationCorrection(summary: PaAgentTurnSummary) {
        if (
            this.citationCorrectionRequested
            || summary.controlSnapshot?.toolMode === "final_answer_only"
        ) {
            return citationProtocolIncompleteDecision();
        }
        this.citationCorrectionRequested = true;
        return {
            action: "continue" as const,
            reason: "corrective_turn" as const,
            toolMode: "final_answer_only" as const,
            runtimeInstruction: [
                "The finding used a vault path that is not bound to successful content-read evidence.",
                `This is the one citation-only corrective turn. The only exact vault paths available for citation are ${JSON.stringify(this.contentReadCitationPaths())}.`,
                "Do not call tools, use a basename, invent a title path, or change the finding merely to fit the allowlist.",
                "Return the same finding with every necessary vault path copied exactly from that list and formatted as inline code, or return exactly NO_INSIGHT if it cannot be grounded with those paths.",
            ].join(" "),
        };
    }

    private contentReadCitationPaths(): string[] {
        return [
            this.options.anchorPath,
            ...[...this.nonAnchorContentPaths].sort(compareCodePoint),
        ];
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
            const nonAnchorPaths = new Set<string>();
            for (const record of result.content.sourceRecords ?? []) {
                const path = record.path;
                if (!path) continue;
                if (
                    result.toolName === "get_current_note_context"
                    && path === this.options.anchorPath
                ) {
                    this.anchorRead = true;
                } else if (path !== this.options.anchorPath) {
                    nonAnchorPaths.add(path);
                    this.nonAnchorContentPaths.add(path);
                    this.nonAnchorContentTurnByPath.set(
                        path,
                        Math.max(
                            this.nonAnchorContentTurnByPath.get(path) ?? -1,
                            summary.turnIndex,
                        ),
                    );
                }
            }
            if (nonAnchorPaths.size === 1) {
                const [nonAnchorPath] = nonAnchorPaths;
                if (!nonAnchorPath) continue;
                for (const identifier of this.anchorExactIdentifiers) {
                    if (!result.content.promptText.includes(identifier)) continue;
                    const paths = this.contentPathsByAnchorIdentifier.get(identifier)
                        ?? new Set<string>();
                    paths.add(nonAnchorPath);
                    this.contentPathsByAnchorIdentifier.set(identifier, paths);
                }
            }
        }
    }

    private shouldEvaluateSourceCompleteSecondLead(
        summary: PaAgentTurnSummary,
    ): boolean {
        return this.options.canStageInsight === true
            && this.options.hasStagedInsight?.() !== true
            && !this.multiLeadEvaluationRequested
            && summary.controlSnapshot?.toolMode !== "final_answer_only"
            && !this.shouldReserveFinalization(summary)
            && this.hasDistinctSourceCompleteAnchorLeads();
    }

    private hasDistinctSourceCompleteAnchorLeads(): boolean {
        if (!this.anchorRead || this.anchorExactIdentifiers.length < 2) return false;
        for (let leftIndex = 0; leftIndex < this.anchorExactIdentifiers.length; leftIndex += 1) {
            const leftPaths = this.contentPathsByAnchorIdentifier.get(
                this.anchorExactIdentifiers[leftIndex],
            );
            if (!leftPaths || leftPaths.size === 0) continue;
            for (
                let rightIndex = leftIndex + 1;
                rightIndex < this.anchorExactIdentifiers.length;
                rightIndex += 1
            ) {
                const rightPaths = this.contentPathsByAnchorIdentifier.get(
                    this.anchorExactIdentifiers[rightIndex],
                );
                if (!rightPaths || rightPaths.size === 0) continue;
                if ([...leftPaths].some((leftPath) => (
                    [...rightPaths].some((rightPath) => rightPath !== leftPath)
                ))) return true;
            }
        }
        return false;
    }

    private hasContentReadForAnchorIdentifier(identifier: string): boolean {
        return (this.contentPathsByAnchorIdentifier.get(identifier)?.size ?? 0) > 0;
    }

    private shouldCorrectExactLeadAfterDuplicate(summary: PaAgentTurnSummary): boolean {
        return Boolean(this.requiredExactIdentifier)
            && !this.exactSearchCompleted
            && onlyDuplicateStatusResults(summary);
    }

    private shouldVerifyCandidateBeforeTerminal(): boolean {
        return Boolean(this.requiredExactIdentifier)
            && this.exactSearchCompleted
            && this.exactCandidateTurnByPath.size > 0
            && !this.hasVerifiedExactCandidateContent()
            && this.nonAnchorContentPaths.size === 0;
    }

    private hasVerifiedExactCandidateContent(): boolean {
        return [...this.exactCandidateTurnByPath].some(([path, searchTurnIndex]) => (
            (this.nonAnchorContentTurnByPath.get(path) ?? -1) > searchTurnIndex
        ));
    }

    private recordExactSearchEvidence(summary: PaAgentTurnSummary): void {
        if (!this.requiredExactIdentifier) return;
        for (const result of summary.toolResults) {
            if (
                result.toolName !== "search_memory"
                || result.isError
                || !result.content.includeInNextPrompt
                || String(result.content.metadata?.inputSummary ?? "").trim()
                    !== this.requiredExactIdentifier
            ) {
                continue;
            }
            this.exactSearchTurnByToolCallId.set(result.toolCallId, summary.turnIndex);
            this.applyCurrentExactSearchObservation(result.content, summary.turnIndex);
        }
    }

    private applyCurrentExactSearchObservation(
        content: PaAgentTurnSummary["toolResults"][number]["content"],
        turnIndex: number,
    ): void {
        const state = content.metadata?.memoryEvidenceState;
        if (state !== "none" && state !== "evidence" && state !== "partial") return;
        this.exactSearchCompleted = true;
        const candidates = classifyMemorySearchCandidates(content, this.options.anchorPath);
        if (!candidates.requiresVerification) return;
        this.exactSearchReturnedCandidates = true;
        for (const path of candidates.visibleNonAnchorPaths) {
            const existingTurnIndex = this.exactCandidateTurnByPath.get(path);
            this.exactCandidateTurnByPath.set(
                path,
                existingTurnIndex === undefined
                    ? turnIndex
                    : Math.max(existingTurnIndex, turnIndex),
            );
        }
    }

    private handleExactLeadProtocolViolation(summary: PaAgentTurnSummary) {
        const runtimeInstruction = this.exactSearchCompleted
            ? [
                "The exact Memory search returned a candidate, but no non-anchor content source was read afterward.",
                "This is the one tool-enabled corrective turn: verify one promising non-anchor source with inspect_obsidian_note, search_vault_snippets, or read_note_outline.",
                "Then return one source-grounded finding or exactly NO_INSIGHT; do not broaden into another lead.",
            ].join(" ")
            : [
                `The immutable anchor contains the unresolved exact identifier "${this.requiredExactIdentifier}".`,
                `This is the one tool-enabled corrective turn: call search_memory with exactly "${this.requiredExactIdentifier}"; do not broaden, split, or paraphrase it.`,
                "If the search returns a candidate, verify one promising non-anchor source with inspect_obsidian_note, search_vault_snippets, or read_note_outline before returning NO_INSIGHT.",
            ].join(" ");
        return this.requestExactLeadTerminalCorrection(summary, runtimeInstruction);
    }

    private handleUnverifiedCandidateTerminal(summary: PaAgentTurnSummary) {
        const candidatePath = [...this.exactCandidateTurnByPath.keys()][0];
        return this.requestExactLeadTerminalCorrection(summary, [
            "The exact Memory search returned a visible non-anchor candidate, but the terminal finding has no non-anchor content-read evidence.",
            `This is the one bounded tool-enabled corrective turn: read the same candidate path "${candidatePath}" with inspect_obsidian_note, search_vault_snippets, or read_note_outline before finalizing.`,
            "Return one source-grounded finding or exactly NO_INSIGHT after that verification; do not broaden into another lead.",
        ].join(" "));
    }

    private requestExactLeadTerminalCorrection(
        summary: PaAgentTurnSummary,
        runtimeInstruction: string,
    ) {
        this.exactLeadTerminalViolations += 1;
        if (
            this.exactLeadTerminalViolations > 1
            || summary.controlSnapshot?.toolMode === "final_answer_only"
        ) {
            this.exactLeadProtocolExhausted = true;
            return exactLeadProtocolIncompleteDecision(
                "pagelet_exact_lead_protocol_exhausted",
            );
        }
        return {
            action: "continue" as const,
            reason: "corrective_turn" as const,
            runtimeInstruction,
        };
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
        const sourceCompleteSecondLead = this.options.canStageInsight === true
            && this.hasDistinctSourceCompleteAnchorLeads();
        const staged = this.options.hasStagedInsight?.() === true;
        return [
            staged
                ? "A verified first insight is pinned. Continue only to resolve its one concrete distinct lead, then finalize a second or exactly NO_INSIGHT."
                : "Continue only from the strongest evidence-backed lead.",
            "The normal target is 3–5 model turns and 8–12 real tool calls; 30 calls and 180 seconds are emergency fuses, not exploration targets.",
            staged
                ? "Do not repeat, expand, summarize, or combine the pinned first insight in the terminal text."
                : sourceCompleteSecondLead
                ? "The anchor and distinct current non-anchor content sources for at least two concrete anchor leads are already observed. Evaluate only those already-read leads now: if both independently clear the grounding, currentness, novelty, and value gates, stage the complete first and later return only the distinct second; if only one clears, finalize one. Do not open another search branch to fill a slot."
                : answerReady
                ? "The anchor and at least one non-anchor content source are already observed. Normally finalize one worthwhile contradiction, evolution, gap, risk, or implication now; otherwise make only the smallest tool batch needed to resolve one specific gap."
                : "First establish the frozen anchor plus at least one non-anchor content source; search or metadata leads alone are not final evidence.",
            sourceCompleteSecondLead
                ? "Use only the current content reads; do not broaden or spend calls merely to reach two."
                : turnsUsed >= 3 || this.executedToolCalls >= 8
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
                this.options.hasStagedInsight?.() === true
                    ? "Return only one distinct second source-grounded Markdown finding now, or exactly NO_INSIGHT; the pinned first remains available internally."
                    : "Return the strongest source-grounded Markdown finding now.",
                this.citationInstruction(),
                "If none is adequately supported, return exactly NO_INSIGHT.",
            ].join(" "),
        };
    }
}

function exactLeadProtocolIncompleteDecision(reason: string) {
    return {
        action: "stop" as const,
        status: "incomplete" as const,
        reason,
        diagnostics: [{
            type: "pagelet_exact_lead_protocol_incomplete",
            message: "The exact-lead verification protocol remained incomplete.",
        }],
    };
}

function citationProtocolIncompleteDecision() {
    return {
        action: "stop" as const,
        status: "incomplete" as const,
        reason: "pagelet_citation_protocol_exhausted",
        diagnostics: [{
            type: "pagelet_citation_protocol_incomplete",
            message: "The terminal citation-only correction remained ungrounded.",
        }],
    };
}

function stageShapeProtocolIncompleteDecision() {
    return {
        action: "stop" as const,
        status: "incomplete" as const,
        reason: "pagelet_stage_shape_protocol_incomplete",
        diagnostics: [{
            type: "pagelet_stage_shape_protocol_incomplete",
            message: "The one corrected Pagelet staging attempt did not produce a verified staged insight.",
        }],
    };
}

function stageValidationFailureDecision(
    reason: Extract<
        ChatToolUnavailableReason,
        | "pagelet_stage_validation_deadline"
        | "pagelet_stage_first_rejected"
        | "pagelet_stage_lead_rejected"
    >,
) {
    return {
        action: "stop" as const,
        status: "incomplete" as const,
        reason,
        diagnostics: [{
            type: "pagelet_stage_validation_incomplete",
            message: "The staged insight failed current Host validation; no further model recovery was allowed.",
        }],
    };
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function isDistinctExactIdentifier(literal: string): boolean {
    const prefix = literal.split(/[-_:]/, 1)[0] ?? "";
    const knownPrefix = KNOWN_EXACT_LEAD_PREFIXES.has(prefix.toLowerCase());
    const separatorCount = (literal.match(/[-_:]/g) ?? []).length;
    const uppercaseCount = [...prefix].filter((character) => (
        character >= "A" && character <= "Z"
    )).length;
    return /\d/.test(literal)
        && (knownPrefix || (uppercaseCount >= 2 && separatorCount >= 2));
}

function hasUnresolvedContext(content: string, start: number, length: number): boolean {
    const clauseStart = findClauseStart(content, start);
    const clauseEnd = findClauseEnd(content, start + length);
    const clause = content.slice(clauseStart, clauseEnd);
    const literalStart = start - clauseStart;
    const literalEnd = literalStart + length;
    const unresolvedDistance = nearestCueDistance(
        clause,
        literalStart,
        literalEnd,
        UNRESOLVED_CONTEXT_PATTERN,
    );
    if (unresolvedDistance > MAX_EXACT_LEAD_CUE_DISTANCE) return false;
    const resolvedDistance = nearestCueDistance(
        clause,
        literalStart,
        literalEnd,
        RESOLVED_CONTEXT_PATTERN,
    );
    return unresolvedDistance < resolvedDistance;
}

function findClauseStart(content: string, literalStart: number): number {
    for (let index = literalStart - 1; index >= 0; index -= 1) {
        if (EXACT_LEAD_CONTEXT_BOUNDARY_PATTERN.test(content[index] ?? "")) {
            return index + 1;
        }
    }
    return 0;
}

function findClauseEnd(content: string, literalEnd: number): number {
    for (let index = literalEnd; index < content.length; index += 1) {
        if (EXACT_LEAD_CONTEXT_BOUNDARY_PATTERN.test(content[index] ?? "")) {
            return index;
        }
    }
    return content.length;
}

function nearestCueDistance(
    clause: string,
    literalStart: number,
    literalEnd: number,
    pattern: RegExp,
): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const match of clause.matchAll(pattern)) {
        const cueStart = match.index ?? 0;
        const cueEnd = cueStart + match[0].length;
        const distance = cueEnd <= literalStart
            ? literalStart - cueEnd
            : cueStart >= literalEnd
                ? cueStart - literalEnd
                : 0;
        nearest = Math.min(nearest, distance);
    }
    return nearest;
}

function assistantTerminalText(summary: PaAgentTurnSummary): string {
    if (summary.assistantMessage.role !== "assistant") return "";
    return summary.assistantMessage.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
}

function classifyMemorySearchCandidates(
    content: PaAgentTurnSummary["toolResults"][number]["content"],
    anchorPath: string,
): {
    requiresVerification: boolean;
    visibleNonAnchorPaths: ReadonlySet<string>;
} {
    const metadata = content.metadata;
    const hitCount = Number(metadata?.hitCount ?? 0);
    const candidateCount = Number(metadata?.candidateCount ?? 0);
    const visiblePathRecords = (content.sourceRecords ?? []).flatMap((record) => (
        record.path ? [record.path] : []
    ));
    const visiblePaths = new Set(visiblePathRecords);
    const visibleNonAnchorPaths = new Set([...visiblePaths].filter((path) => (
        path !== anchorPath
    )));
    const hiddenHit = Number.isFinite(hitCount) && hitCount > visiblePathRecords.length;
    const hiddenCandidate = Number.isFinite(candidateCount)
        && candidateCount > visiblePaths.size;
    return {
        requiresVerification: visibleNonAnchorPaths.size > 0 || hiddenHit || hiddenCandidate,
        visibleNonAnchorPaths,
    };
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

function onlyStageShapeValidationFailures(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.length > 0
        && summary.toolResults.every((result) => (
            result.toolName === PAGELET_STAGE_INSIGHT_TOOL_NAME
            && result.isError
            && result.content.metadata?.outcome === "schema_invalid"
            && result.content.metadata?.reason === "input_validation_failed"
        ));
}

function getStageValidationFailureReason(
    summary: PaAgentTurnSummary,
): Extract<
    ChatToolUnavailableReason,
    | "pagelet_stage_validation_deadline"
    | "pagelet_stage_first_rejected"
    | "pagelet_stage_lead_rejected"
> | undefined {
    for (const result of summary.toolResults) {
        if (result.toolName !== PAGELET_STAGE_INSIGHT_TOOL_NAME || !result.isError) continue;
        const reason = result.content.metadata?.unavailableReason;
        if (
            reason === "pagelet_stage_validation_deadline"
            || reason === "pagelet_stage_first_rejected"
            || reason === "pagelet_stage_lead_rejected"
        ) return reason;
    }
    return undefined;
}

function onlyDuplicateStatusResults(summary: PaAgentTurnSummary): boolean {
    return summary.toolResults.length > 0
        && summary.toolResults.every((result) => (
            !result.content.includeInNextPrompt
            && (
                result.content.metadata?.outcome === "duplicate_skipped"
                || result.content.metadata?.reason === "duplicate_tool_call"
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
