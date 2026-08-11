import type { AgentCapability, AgentCapabilityResult } from "../../ai-services/capability-types";
import type { ChatToolContext, ChatToolName } from "../../ai-services/chat-tools";
import type {
    ChatToolUnavailableReason,
    MemorySearchResult,
    PaAgentMessage,
    SourceRecord,
} from "../../ai-services/chat-types";
import { projectMemorySearchObservation } from "../../ai-services/pa-agent-host-tools";
import { createSourceDedupKey } from "../../ai-services/source-store";
import { cloneTranscript } from "../../ai-services/context/clone-utils";
import { mergeMemorySearchResults } from "../../ai-services/retrieval-recovery-coordinator";
import type { RetrievalDiagnosticRecorder } from "../../ai-services/retrieval-diagnostics";
import type {
    PageletAgentInsightDraft,
    PageletAgentRecoveryDiagnostics,
    StagePageletInsightInput,
} from "./types";

export const PAGELET_STAGE_INSIGHT_TOOL_NAME = "stage_pagelet_insight";
const PAGELET_RECOVERY_MIN_EXECUTION_MS = 2_000;
const PAGELET_RECOVERY_MAX_ATTEMPT_MS = 10_000;
const PAGELET_RECOVERY_PROJECTION_MARGIN_MS = 500;

interface RecoveryEpisode {
    result: MemorySearchResult;
    sourceIds: ReadonlySet<string>;
    toolCallId?: string;
}

interface StageValidationResult {
    accepted: boolean;
    rejection?: "first" | "lead";
    verifiedSourceIds?: readonly string[];
    verifiedLeadSourceIds?: readonly string[];
}

export interface PageletRecoveryCoordinatorOptions {
    enabled: boolean;
    anchorPath: string;
    policyEpoch?: string;
    isEnabled?: () => boolean;
    getPolicyEpoch?: () => string;
    onPolicyChanged?: (listener: () => void | Promise<void>) => () => void;
    startedAt: number;
    maxWallClockMs: number;
    finalizationReserveMs: number;
    recordDiagnostic?: RetrievalDiagnosticRecorder;
    runEpoch: string;
    now: () => number;
    executeStandard(
        query: string,
        context: ChatToolContext,
        control: { runEpoch: string; absoluteDeadlineMs: number },
    ): Promise<MemorySearchResult>;
    executeRelaxed?(
        seed: MemorySearchResult,
        context: ChatToolContext,
        goal: "first_insight" | "second_insight",
        control: { runEpoch: string; absoluteDeadlineMs: number },
    ): Promise<MemorySearchResult>;
    revalidate?(
        result: MemorySearchResult,
        signal?: AbortSignal,
    ): Promise<MemorySearchResult>;
    prevalidateStaged(input: StagePageletInsightInput): void;
    validateStaged(
        input: StagePageletInsightInput,
        signal: AbortSignal,
        control: { runEpoch: string; absoluteDeadlineMs: number },
    ): Promise<StageValidationResult>;
}

export interface PageletRecoverySnapshot {
    drafts: PageletAgentInsightDraft[];
    diagnostics: PageletAgentRecoveryDiagnostics;
}

/**
 * Run-local Pagelet recovery state. Search episodes and the token never escape
 * this object; model input contains neither an episode handle nor a recovery
 * query. `clear()` is called on every runtime exit.
 */
export class PageletRecoveryCoordinator {
    private readonly partialEpisodes: RecoveryEpisode[] = [];
    private staged?: PageletAgentInsightDraft;
    private stageControlReserved = false;
    private tokenConsumed = false;
    private relaxedGoal?: "first_insight" | "second_insight";
    private stagedRecovery?: MemorySearchResult;
    private stagedBoundToolCallId?: string;
    private activeMemorySearchToolCallId?: string;
    private readonly activeChildControllers = new Set<AbortController>();
    private readonly activeRecoveryControllers = new Set<AbortController>();
    private readonly initialPolicyEpoch?: string;
    private readonly recordDiagnostic?: RetrievalDiagnosticRecorder;
    private unsubscribePolicy?: () => void;
    private lifecycleEpoch = 0;
    private disposed = false;
    private recoveryDisabled = false;

    constructor(private readonly options: PageletRecoveryCoordinatorOptions) {
        this.recordDiagnostic = createSafeDiagnosticRecorder(options.recordDiagnostic);
        this.initialPolicyEpoch = options.policyEpoch ?? options.getPolicyEpoch?.();
        if (options.enabled) {
            this.unsubscribePolicy = options.onPolicyChanged?.(() => {
                if (!this.isRecoveryPolicyCurrent()) this.disableRecovery();
            });
            if (!this.isRecoveryPolicyCurrent()) this.disableRecovery();
        }
    }

    /**
     * Bind a model-visible search call to the Host-owned recovery episode it
     * creates. Pagelet dispatches search_memory sequentially, so this binding
     * cannot bleed across sibling calls.
     */
    async withMemorySearchToolCall<T>(
        toolCallId: string,
        task: () => Promise<T>,
    ): Promise<T> {
        if (this.activeMemorySearchToolCallId) {
            throw new Error("Concurrent Pagelet Memory tool-call binding is unavailable.");
        }
        this.activeMemorySearchToolCallId = toolCallId;
        try {
            return await task();
        } finally {
            if (this.activeMemorySearchToolCallId === toolCallId) {
                this.activeMemorySearchToolCallId = undefined;
            }
        }
    }

    async executeMemorySearch(
        query: string,
        context: ChatToolContext,
    ): Promise<MemorySearchResult> {
        const lifecycleEpoch = this.lifecycleEpoch;
        const absoluteDeadlineMs = this.options.startedAt + this.options.maxWallClockMs;
        const standardStartedAt = this.recordDiagnostic ? this.options.now() : 0;
        this.recordDiagnostic?.({
            phase: "recovery_standard",
            outcome: "started",
            metrics: { remainingMs: Math.max(0, absoluteDeadlineMs - standardStartedAt) },
        });
        let standard: MemorySearchResult | null;
        try {
            standard = await this.runBeforeDeadline(
                (signal, deadline) => this.options.executeStandard(
                    query,
                    { ...context, signal },
                    {
                        runEpoch: this.options.runEpoch,
                        absoluteDeadlineMs: deadline,
                    },
                ),
                context.signal,
                absoluteDeadlineMs,
            );
        } catch (error) {
            this.recordDiagnostic?.({
                phase: "recovery_standard",
                outcome: context.signal?.aborted ? "aborted" : "failed",
                reason: context.signal?.aborted ? "attempt_aborted" : "attempt_failed",
                metrics: { durationMs: this.options.now() - standardStartedAt },
            });
            throw error;
        }
        if (!standard) {
            this.recordDiagnostic?.({
                phase: "recovery_standard",
                outcome: context.signal?.aborted ? "aborted" : "deadline",
                reason: context.signal?.aborted ? "attempt_aborted" : "attempt_deadline",
                metrics: { durationMs: this.options.now() - standardStartedAt },
            });
            if (!this.isCurrentLifecycle(lifecycleEpoch) || context.signal?.aborted) {
                this.recordRelaxedSkipped("coordinator_closed");
                throw createAbortError();
            }
            throw createDeadlineError("Pagelet standard Memory search exceeded its run deadline.");
        }
        const standardUnavailable = standard.memoryEvidenceState === "unavailable";
        const standardDocumentDiagnostic = completedMemoryDocumentDiagnostic(standard);
        this.recordDiagnostic?.({
            phase: "recovery_standard",
            outcome: standardUnavailable ? "failed" : "completed",
            ...(standardUnavailable
                ? { reason: "standard_unavailable" }
                : standardDocumentDiagnostic.reason
                    ? { reason: standardDocumentDiagnostic.reason }
                    : {}),
            metrics: {
                durationMs: this.options.now() - standardStartedAt,
                ...(standardUnavailable || standardDocumentDiagnostic.documentCount === undefined
                    ? {}
                    : { documentCount: standardDocumentDiagnostic.documentCount }),
            },
        });
        if (!this.isCurrentLifecycle(lifecycleEpoch)) {
            this.recordRelaxedSkipped("coordinator_closed");
            throw createAbortError();
        }
        if (!this.isRecoveryPolicyCurrent()) {
            this.recordRelaxedSkipped("flag_off");
            return standard;
        }
        if (standardUnavailable) {
            this.recordRelaxedSkipped("standard_unavailable");
            return standard;
        }

        if (isEligiblePartial(standard)) this.recordPartial(standard);
        if (this.stageControlReserved) {
            this.recordRelaxedSkipped("stage_control_reserved");
            return standard;
        }
        if (!isEligibleNone(standard)) {
            this.recordRelaxedSkipped(
                isEligiblePartial(standard) ? "partial_requires_stage" : "standard_sufficient",
            );
            return standard;
        }
        const firstInsightUnavailable = this.relaxedUnavailableReason();
        if (firstInsightUnavailable) {
            this.recordRelaxedSkipped(firstInsightUnavailable);
            return standard;
        }

        this.consumeToken("first_insight");
        try {
            const relaxed = await this.runRelaxed(standard, context, "first_insight");
            if (!this.isCurrentLifecycle(lifecycleEpoch)) throw createAbortError();
            if (!this.isRecoveryPolicyCurrent()) return standard;
            return relaxed ?? standard;
        } catch (error) {
            if (!this.isCurrentLifecycle(lifecycleEpoch)) throw createAbortError();
            if (context.signal?.aborted) throw error;
            return standard;
        }
    }

    reserveStageControl(raw: unknown): StagePageletInsightInput {
        if (this.disposed || !this.isRecoveryPolicyCurrent()) {
            this.recordRelaxedSkipped("stage_unavailable");
            throw new Error("Pagelet insight staging is unavailable.");
        }
        if (this.stageControlReserved) {
            this.recordRelaxedSkipped("stage_control_reserved");
            throw new Error("stage_pagelet_insight may be called at most once per run.");
        }
        const input = this.prepareStageInput(raw);
        this.stageControlReserved = true;
        return input;
    }

    async stage(
        input: StagePageletInsightInput,
        context: ChatToolContext,
    ): Promise<AgentCapabilityResult> {
        if (this.disposed || !this.isRecoveryPolicyCurrent() || this.staged) {
            this.recordRelaxedSkipped("stage_unavailable");
            return unavailable(
                "The Pagelet staging control is no longer available.",
                "pagelet_stage_control_unavailable",
            );
        }
        const lifecycleEpoch = this.lifecycleEpoch;
        const validation = await this.runBeforeSoftDeadline(
            (signal, absoluteDeadlineMs) => this.options.validateStaged(
                input,
                signal,
                {
                    runEpoch: this.options.runEpoch,
                    absoluteDeadlineMs,
                },
            ),
            context.signal,
        );
        if (!this.isCurrentLifecycle(lifecycleEpoch) || !this.isRecoveryPolicyCurrent()) {
            this.recordRelaxedSkipped("stage_unavailable");
            return unavailable(
                "The Pagelet staging control is no longer available.",
                "pagelet_stage_control_unavailable",
            );
        }
        if (!validation) {
            this.recordRelaxedSkipped("stage_validation_deadline");
            return unavailable(
                "The provisional insight could not be validated before the run deadline.",
                "pagelet_stage_validation_deadline",
            );
        }
        const verifiedSourceIds = validation.verifiedSourceIds ?? [];
        const verifiedLeadSourceIds = validation.verifiedLeadSourceIds ?? [];
        const firstVerified = verifiedSourceIds.length >= 2;
        const leadVerified = verifiedLeadSourceIds.length >= 1;
        if (!validation.accepted || !firstVerified || !leadVerified) {
            const leadRejected = validation.rejection === "lead" && firstVerified;
            this.recordRelaxedSkipped("stage_validation_failed");
            return unavailable(
                "The provisional insight was not grounded in current allowed evidence.",
                leadRejected
                    ? "pagelet_stage_lead_rejected"
                    : "pagelet_stage_first_rejected",
            );
        }
        this.staged = {
            body: input.insightMarkdown.trim(),
            origin: "staged",
            declaredSourceIds: [...verifiedSourceIds],
        };

        const baseObservation = {
            status: "staged",
            instruction: "The first insight is pinned. Finalize one distinct second insight next, or return exactly NO_INSIGHT.",
        };
        if (!input.unresolvedLead.requestRelaxedRecovery) {
            this.recordRelaxedSkipped("lead_not_requested");
            return ok(baseObservation, []);
        }
        const secondInsightUnavailable = this.relaxedUnavailableReason();
        if (secondInsightUnavailable) {
            this.recordRelaxedSkipped(secondInsightUnavailable);
            return ok(baseObservation, []);
        }

        const leadSources = new Set(verifiedLeadSourceIds);
        const episode = await this.latestCurrentEligiblePartial(leadSources, context.signal);
        if (!this.isCurrentLifecycle(lifecycleEpoch)) {
            this.recordRelaxedSkipped("stage_unavailable");
            return unavailable(
                "The Pagelet staging control is no longer available.",
                "pagelet_stage_control_unavailable",
            );
        }
        if (!episode) {
            this.recordRelaxedSkipped("concrete_lead_unavailable");
            return ok({
                ...baseObservation,
                recovery: "not-authorized",
            }, []);
        }

        this.consumeToken("second_insight");
        try {
            const recovered = await this.runRelaxed(episode.result, context, "second_insight");
            if (!this.isCurrentLifecycle(lifecycleEpoch)) {
                this.recordDiagnostic?.({
                    phase: "recovery_relaxed",
                    outcome: "late_discarded",
                    reason: "coordinator_closed",
                    metrics: { retryConsumed: 1 },
                });
                return unavailable(
                    "The Pagelet staging control is no longer available.",
                    "pagelet_stage_control_unavailable",
                );
            }
            if (!recovered) {
                return ok({
                    ...baseObservation,
                    recovery: "unavailable",
                }, []);
            }
            this.stagedRecovery = recovered;
            this.stagedBoundToolCallId = episode.toolCallId;
            return ok({
                ...baseObservation,
                recovery: "completed",
                evidence: projectPageletRecoveryEvidence(recovered),
            }, memorySourceRecords(recovered));
        } catch (error) {
            if (!this.isCurrentLifecycle(lifecycleEpoch)) {
                return unavailable(
                    "The Pagelet staging control is no longer available.",
                    "pagelet_stage_control_unavailable",
                );
            }
            if (context.signal?.aborted) throw error;
            return ok({
                ...baseObservation,
                recovery: "unavailable",
            }, []);
        }
    }

    getStageCapability(): AgentCapability {
        const name = PAGELET_STAGE_INSIGHT_TOOL_NAME as ChatToolName;
        const inputSchema = {
            type: "object" as const,
            properties: {
                insightMarkdown: {
                    type: "string" as const,
                    minLength: 1,
                    maxLength: 16_000,
                    description: "Exactly one complete provisional natural-Markdown insight. Never bundle the distinct lead or a second insight into this field.",
                },
                sourceIds: {
                    type: "array" as const,
                    items: {
                        type: "string" as const,
                        minLength: 1,
                        maxLength: 512,
                    },
                    minItems: 2,
                    maxItems: 16,
                    uniqueItems: true,
                    description: `At least two unique exact vault paths cited by and materially supporting the first insight only. This set must include the frozen anchor path ${JSON.stringify(this.options.anchorPath)} and equal that first insight's verified sources.`,
                },
                unresolvedLead: {
                    type: "object" as const,
                    properties: {
                        leadKey: { type: "string" as const, minLength: 1, maxLength: 160 },
                        supportingSourceIds: {
                            type: "array" as const,
                            items: {
                                type: "string" as const,
                                minLength: 1,
                                maxLength: 512,
                            },
                            minItems: 1,
                            maxItems: 16,
                            uniqueItems: true,
                            description: `At least one unique exact current non-anchor vault path from successful content-reading tools that supports the distinct lead. The frozen anchor path ${JSON.stringify(this.options.anchorPath)} is invalid here. This set may be disjoint from sourceIds; metadata or search-only paths are invalid.`,
                        },
                        requestRelaxedRecovery: {
                            type: "boolean" as const,
                            description: "False when current content evidence already completes the second insight; true only when the concrete lead still needs eligible Host-owned relaxed recovery.",
                        },
                    },
                    required: ["leadKey", "supportingSourceIds", "requestRelaxedRecovery"],
                    additionalProperties: false,
                },
            },
            required: ["insightMarkdown", "sourceIds", "unresolvedLead"],
            additionalProperties: false,
        };
        const definition = {
            name,
            description: [
                "Pin one already-supported natural-Markdown Pagelet insight before pursuing one concrete, distinct unresolved lead.",
                "A terminal response may contain at most one insight: for two findings, stage only the first here and return only the second in terminal Markdown.",
                "This control is Pagelet-only and may be called once. It does not create a second run and cannot write notes.",
            ].join(" "),
            inputSchema,
            plannerGuidance: [
                "Use only after the first insight is fully source-backed.",
                "Keep sourceIds exact to the first insight and put distinct lead evidence only in supportingSourceIds; the sets may be disjoint.",
                "When the second insight is already complete, set requestRelaxedRecovery=false, stage the first, then return only the second.",
                "Request relaxed recovery only for one concrete lead backed by the latest partial Memory evidence.",
            ],
            permission: "read-only" as const,
            cost: "free" as const,
            outputBudgetChars: 8_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable" as const,
            statusMessage: "Staging one source-backed insight",
            sourceBoundary: "read-only-tool" as const,
        };
        return {
            ...definition,
            kind: "tool",
            origin: "core",
            providerId: "pagelet-deep-discover-host-control",
            platform: "both",
            timeoutMs: 30_000,
            statusMessageText: definition.statusMessage,
            sourceRecordKind: "context-used",
            executionMode: "sequential",
            prepareAndValidate: (raw) => {
                try {
                    return {
                        ok: true,
                        input: this.prepareStageInput(raw),
                    };
                } catch (error) {
                    return {
                        ok: false,
                        error: error instanceof Error ? error : new Error(String(error)),
                    };
                }
            },
            toProviderSchema: () => ({
                type: "function",
                function: {
                    name,
                    description: definition.description,
                    parameters: inputSchema,
                },
            }),
            toRegistryDefinition: () => ({ ...definition }),
            execute: async (input, context) => {
                let reserved: StagePageletInsightInput;
                try {
                    reserved = this.reserveStageControl(input);
                } catch (error) {
                    return unavailable(
                        error instanceof Error ? error.message : String(error),
                        "pagelet_stage_control_unavailable",
                    );
                }
                return this.stage(
                    reserved,
                    {
                        host: context.host,
                        signal: context.signal,
                        onBeforeVssSearch: context.onBeforeVssSearch,
                        onToolRunning: context.onToolRunning,
                    },
                );
            },
        };
    }

    async prepareTranscript(
        transcript: readonly PaAgentMessage[],
        signal?: AbortSignal,
    ): Promise<PaAgentMessage[]> {
        const projected = cloneTranscript(transcript);
        if (!this.stagedRecovery) return projected;
        const lifecycleEpoch = this.lifecycleEpoch;
        const stageMessage = [...projected].reverse().find((message): message is Extract<
            PaAgentMessage,
            { role: "toolResult" }
        > => message.role === "toolResult" && message.toolName === PAGELET_STAGE_INSIGHT_TOOL_NAME);
        if (!stageMessage) return projected;

        let current: MemorySearchResult | null = null;
        let projectionFailed = false;
        const projectionStartedAt = this.recordDiagnostic ? this.options.now() : 0;
        this.recordDiagnostic?.({ phase: "recovery_projection", outcome: "started" });
        try {
            current = this.options.revalidate
                ? await this.runBeforeSoftDeadline(
                    (childSignal) => this.options.revalidate!(this.stagedRecovery!, childSignal),
                    signal,
                )
                : this.stagedRecovery;
        } catch (error) {
            projectionFailed = true;
            this.recordDiagnostic?.({
                phase: "recovery_projection",
                outcome: signal?.aborted ? "aborted" : "failed",
                reason: signal?.aborted ? "projection_aborted" : "projection_failed",
                metrics: { durationMs: this.options.now() - projectionStartedAt },
            });
            if (signal?.aborted) throw error;
        }
        const projectionUnavailable = current?.memoryEvidenceState === "unavailable";
        const projectionDocumentDiagnostic = current
            ? completedMemoryDocumentDiagnostic(current)
            : {};
        if (current && !projectionUnavailable) {
            this.recordDiagnostic?.({
                phase: "recovery_projection",
                outcome: "completed",
                ...(projectionDocumentDiagnostic.reason
                    ? { reason: projectionDocumentDiagnostic.reason }
                    : {}),
                metrics: {
                    durationMs: this.options.now() - projectionStartedAt,
                    ...(projectionDocumentDiagnostic.documentCount === undefined
                        ? {}
                        : { documentCount: projectionDocumentDiagnostic.documentCount }),
                },
            });
        } else if (!signal?.aborted && !projectionFailed) {
            this.recordDiagnostic?.({
                phase: "recovery_projection",
                outcome: "fallback",
                reason: "projection_unavailable",
                metrics: { durationMs: this.options.now() - projectionStartedAt },
            });
        }
        if (!this.isCurrentLifecycle(lifecycleEpoch)) return projected;
        if (!current || current.sources.length === 0) {
            this.stagedRecovery = undefined;
            this.stagedBoundToolCallId = undefined;
            stageMessage.content = {
                ...stageMessage.content,
                promptText: JSON.stringify({
                    tool: PAGELET_STAGE_INSIGHT_TOOL_NAME,
                    status: "ok",
                    observation: {
                        status: "staged",
                        recovery: "unavailable",
                        instruction: "Keep the pinned first insight and finalize with exactly NO_INSIGHT unless ordinary current evidence supports a distinct second.",
                    },
                }),
                sourceRecords: [],
                contextUsed: [],
            };
            return projected;
        }

        this.stagedRecovery = current;
        if (this.stagedBoundToolCallId) {
            const boundMessage = projected.find((message): message is Extract<
                PaAgentMessage,
                { role: "toolResult" }
            > => (
                message.role === "toolResult"
                && message.toolName === "search_memory"
                && message.toolCallId === this.stagedBoundToolCallId
            ));
            if (boundMessage) replaceBoundMemoryObservation(boundMessage);
        }
        const sourceRecords = memorySourceRecords(current);
        stageMessage.content = {
            ...stageMessage.content,
            promptText: JSON.stringify({
                tool: PAGELET_STAGE_INSIGHT_TOOL_NAME,
                status: "ok",
                observation: {
                    status: "staged",
                    recovery: "completed",
                    instruction: "The first insight is pinned. Finalize one distinct second insight next, or return exactly NO_INSIGHT.",
                    evidence: projectPageletRecoveryEvidence(current),
                },
            }),
            sourceRecords,
            contextUsed: [],
        };
        return projected;
    }

    snapshot(finalText: string): PageletRecoverySnapshot {
        const drafts: PageletAgentInsightDraft[] = [];
        if (this.staged) drafts.push({ ...this.staged, declaredSourceIds: [...this.staged.declaredSourceIds] });
        const terminal = finalText.trim();
        if (terminal && terminal !== "NO_INSIGHT") {
            drafts.push({ body: terminal, origin: "terminal", declaredSourceIds: [] });
        }
        return {
            drafts: drafts.slice(0, 2),
            diagnostics: {
                enabled: this.options.enabled,
                stageControlCalled: this.stageControlReserved,
                relaxedTokenConsumed: this.tokenConsumed,
                ...(this.relaxedGoal ? { relaxedGoal: this.relaxedGoal } : {}),
            },
        };
    }

    hasStagedInsight(): boolean {
        return Boolean(this.staged);
    }

    private prepareStageInput(raw: unknown): StagePageletInsightInput {
        const input = validateStageInput(raw, this.options.anchorPath);
        this.options.prevalidateStaged(input);
        return input;
    }

    clear(): void {
        this.disposed = true;
        this.lifecycleEpoch += 1;
        this.unsubscribePolicy?.();
        this.unsubscribePolicy = undefined;
        for (const controller of this.activeChildControllers) controller.abort();
        this.activeChildControllers.clear();
        this.activeRecoveryControllers.clear();
        this.partialEpisodes.length = 0;
        this.staged = undefined;
        this.stageControlReserved = false;
        this.tokenConsumed = false;
        this.relaxedGoal = undefined;
        this.stagedRecovery = undefined;
        this.stagedBoundToolCallId = undefined;
        this.activeMemorySearchToolCallId = undefined;
    }

    private recordPartial(result: MemorySearchResult): void {
        this.partialEpisodes.push({
            result,
            sourceIds: new Set(result.sources.map((source) => source.path)),
            ...(this.activeMemorySearchToolCallId
                ? { toolCallId: this.activeMemorySearchToolCallId }
                : {}),
        });
    }

    private async latestCurrentEligiblePartial(
        leadSources: ReadonlySet<string>,
        signal?: AbortSignal,
    ): Promise<RecoveryEpisode | null> {
        for (let index = this.partialEpisodes.length - 1; index >= 0; index -= 1) {
            const episode = this.partialEpisodes[index];
            if (!episode.toolCallId) continue;
            if (![...leadSources].some((source) => episode.sourceIds.has(source))) continue;
            let current = episode.result;
            try {
                const revalidated = this.options.revalidate
                    ? await this.runBeforeSoftDeadline(
                        (childSignal) => this.options.revalidate!(episode.result, childSignal),
                        signal,
                    )
                    : current;
                if (!revalidated) continue;
                current = revalidated;
            } catch (error) {
                if (signal?.aborted) throw error;
                continue;
            }
            if (!isEligiblePartial(current)) continue;
            const currentSources = new Set(current.sources.map((source) => source.path));
            if (![...leadSources].some((source) => currentSources.has(source))) continue;
            return {
                result: current,
                sourceIds: currentSources,
                toolCallId: episode.toolCallId,
            };
        }
        return null;
    }

    private relaxedUnavailableReason(): string | undefined {
        if (this.disposed) return "coordinator_closed";
        if (!this.isRecoveryPolicyCurrent()) return "flag_off";
        if (this.tokenConsumed) return "token_consumed";
        if (!this.options.executeRelaxed) return "executor_unavailable";
        const elapsed = Math.max(0, this.options.now() - this.options.startedAt);
        const remainingMs = this.options.maxWallClockMs - elapsed;
        const allowed = remainingMs
            >= this.options.finalizationReserveMs
                + PAGELET_RECOVERY_PROJECTION_MARGIN_MS
                + PAGELET_RECOVERY_MIN_EXECUTION_MS;
        if (!allowed) {
            this.recordDiagnostic?.({
                phase: "finalization_reserve",
                outcome: "skipped",
                reason: "reserve_protected",
                metrics: { remainingMs: Math.max(0, remainingMs) },
            });
        }
        return allowed ? undefined : "reserve_protected";
    }

    private consumeToken(goal: "first_insight" | "second_insight"): void {
        this.tokenConsumed = true;
        this.relaxedGoal = goal;
    }

    private async runRelaxed(
        seed: MemorySearchResult,
        context: ChatToolContext,
        goal: "first_insight" | "second_insight",
    ): Promise<MemorySearchResult | null> {
        if (!this.options.executeRelaxed) return null;
        const startedAt = this.recordDiagnostic ? this.options.now() : 0;
        this.recordDiagnostic?.({
            phase: "recovery_relaxed",
            outcome: "started",
            metrics: {
                retryConsumed: 1,
                remainingMs: Math.max(0, this.softDeadlineAt() - startedAt),
            },
        });
        let relaxed: MemorySearchResult | null;
        try {
            relaxed = await this.runBeforeSoftDeadline(
                (signal, absoluteDeadlineMs) => this.options.executeRelaxed!(
                    seed,
                    { ...context, signal },
                    goal,
                    {
                        runEpoch: this.options.runEpoch,
                        absoluteDeadlineMs,
                    },
                ),
                context.signal,
            );
        } catch (error) {
            this.recordDiagnostic?.({
                phase: "recovery_relaxed",
                outcome: context.signal?.aborted ? "aborted" : "failed",
                reason: context.signal?.aborted ? "attempt_aborted" : "attempt_failed",
                metrics: { durationMs: this.options.now() - startedAt, retryConsumed: 1 },
            });
            throw error;
        }
        const relaxedUnavailable = relaxed?.memoryEvidenceState === "unavailable";
        const relaxedDocumentDiagnostic = relaxed
            ? completedMemoryDocumentDiagnostic(relaxed)
            : {};
        this.recordDiagnostic?.({
            phase: "recovery_relaxed",
            outcome: relaxed
                ? relaxedUnavailable ? "failed" : "completed"
                : "deadline",
            reason: relaxed
                ? relaxedUnavailable
                    ? "source_unavailable"
                    : relaxedDocumentDiagnostic.reason
                : "attempt_deadline",
            metrics: {
                durationMs: this.options.now() - startedAt,
                retryConsumed: 1,
                ...(relaxed && !relaxedUnavailable
                    && relaxedDocumentDiagnostic.documentCount !== undefined
                    ? { documentCount: relaxedDocumentDiagnostic.documentCount }
                    : {}),
            },
        });
        return relaxed ? mergeMemorySearchResults(seed, relaxed) : null;
    }

    private recordRelaxedSkipped(reason: string): void {
        this.recordDiagnostic?.({ phase: "recovery_relaxed", outcome: "skipped", reason });
    }

    private async runBeforeSoftDeadline<T>(
        task: (signal: AbortSignal, absoluteDeadlineMs: number) => Promise<T>,
        parentSignal?: AbortSignal,
    ): Promise<T | null> {
        const softAt = this.softDeadlineAt();
        const remainingMs = softAt - this.options.now();
        if (
            this.disposed
            || remainingMs < PAGELET_RECOVERY_MIN_EXECUTION_MS
            || parentSignal?.aborted
        ) return null;
        const attemptDeadlineMs = Math.min(
            softAt,
            this.options.now() + PAGELET_RECOVERY_MAX_ATTEMPT_MS,
        );

        return await this.runBeforeDeadline(
            task,
            parentSignal,
            attemptDeadlineMs,
            true,
        );
    }

    private async runBeforeDeadline<T>(
        task: (signal: AbortSignal, absoluteDeadlineMs: number) => Promise<T>,
        parentSignal: AbortSignal | undefined,
        absoluteDeadlineMs: number,
        recoveryChild = false,
    ): Promise<T | null> {
        if (
            this.disposed
            || parentSignal?.aborted
            || this.options.now() >= absoluteDeadlineMs
        ) return null;

        const controller = new AbortController();
        this.activeChildControllers.add(controller);
        if (recoveryChild) this.activeRecoveryControllers.add(controller);
        const abortFromParent = () => controller.abort();
        if (parentSignal?.aborted) {
            controller.abort();
        } else {
            parentSignal?.addEventListener("abort", abortFromParent, { once: true });
        }
        const timer = setTimeout(
            () => controller.abort(),
            Math.max(0, absoluteDeadlineMs - this.options.now()),
        );
        let resolveAbort!: (outcome: { kind: "aborted" }) => void;
        const abortOutcome = new Promise<{ kind: "aborted" }>((resolve) => {
            resolveAbort = resolve;
        });
        const onChildAbort = () => resolveAbort({ kind: "aborted" });
        if (controller.signal.aborted) {
            onChildAbort();
        } else {
            controller.signal.addEventListener("abort", onChildAbort, { once: true });
        }
        let taskPromise: Promise<T>;
        try {
            taskPromise = task(controller.signal, absoluteDeadlineMs);
        } catch (error) {
            taskPromise = Promise.reject(error);
        }
        const taskOutcome = taskPromise.then(
            (value) => ({ kind: "completed" as const, value }),
            (error: unknown) => ({ kind: "failed" as const, error }),
        );
        try {
            const outcome = await Promise.race([taskOutcome, abortOutcome]);
            if (outcome.kind === "aborted") {
                if (parentSignal?.aborted) throw createAbortError();
                return null;
            }
            if (
                controller.signal.aborted
                || this.disposed
                || (recoveryChild && !this.isRecoveryPolicyCurrent())
                || this.options.now() >= absoluteDeadlineMs
            ) return null;
            if (outcome.kind === "failed") throw outcome.error;
            return outcome.value;
        } finally {
            clearTimeout(timer);
            parentSignal?.removeEventListener("abort", abortFromParent);
            controller.signal.removeEventListener("abort", onChildAbort);
            this.activeChildControllers.delete(controller);
            this.activeRecoveryControllers.delete(controller);
        }
    }

    private isRecoveryPolicyCurrent(): boolean {
        if (this.disposed || this.recoveryDisabled || !this.options.enabled) return false;
        if (this.options.isEnabled && !this.options.isEnabled()) return false;
        return this.initialPolicyEpoch === undefined
            || this.options.getPolicyEpoch === undefined
            || this.options.getPolicyEpoch() === this.initialPolicyEpoch;
    }

    private disableRecovery(): void {
        if (this.recoveryDisabled) return;
        this.recoveryDisabled = true;
        this.unsubscribePolicy?.();
        this.unsubscribePolicy = undefined;
        for (const controller of this.activeRecoveryControllers) controller.abort();
        this.activeRecoveryControllers.clear();
        this.partialEpisodes.length = 0;
        this.staged = undefined;
        this.stageControlReserved = false;
        this.stagedRecovery = undefined;
        this.stagedBoundToolCallId = undefined;
        this.activeMemorySearchToolCallId = undefined;
    }

    private isCurrentLifecycle(epoch: number): boolean {
        return !this.disposed && this.lifecycleEpoch === epoch;
    }

    private softDeadlineAt(): number {
        return this.options.startedAt
            + this.options.maxWallClockMs
            - this.options.finalizationReserveMs
            - PAGELET_RECOVERY_PROJECTION_MARGIN_MS;
    }
}

function createAbortError(): Error {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
}

function createDeadlineError(message: string): Error {
    const error = new Error(message);
    error.name = "TimeoutError";
    return error;
}

function createSafeDiagnosticRecorder(
    recorder: RetrievalDiagnosticRecorder | undefined,
): RetrievalDiagnosticRecorder | undefined {
    if (!recorder) return undefined;
    return (event) => {
        try {
            recorder(event);
        } catch {
            // Measurement must never affect Pagelet recovery.
        }
    };
}

function completedMemoryDocumentDiagnostic(
    result: MemorySearchResult,
): { reason?: "semantic_none"; documentCount?: number } {
    const documentCount = result.documents.length;
    if (documentCount > 0) return { documentCount };
    return result.memoryEvidenceState === "none"
        ? { reason: "semantic_none", documentCount: 0 }
        : {};
}

function validateStageInput(
    raw: unknown,
    anchorPath: string,
): StagePageletInsightInput {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("stage_pagelet_insight input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const insightMarkdown = stringField(value.insightMarkdown, "insightMarkdown", 16_000);
    const sourceIds = stringArray(value.sourceIds, "sourceIds", 16);
    const lead = value.unresolvedLead;
    if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
        throw new Error("unresolvedLead must be an object.");
    }
    const leadValue = lead as Record<string, unknown>;
    const leadKey = stringField(leadValue.leadKey, "unresolvedLead.leadKey", 160);
    if (/^(?:more|other|second|another|更多|其他|第二|继续)$/iu.test(leadKey)) {
        throw new Error("unresolvedLead.leadKey must name one concrete unresolved claim.");
    }
    const supportingSourceIds = stringArray(
        leadValue.supportingSourceIds,
        "unresolvedLead.supportingSourceIds",
        16,
    );
    if (typeof leadValue.requestRelaxedRecovery !== "boolean") {
        throw new Error("unresolvedLead.requestRelaxedRecovery must be boolean.");
    }
    if (sourceIds.length < 2 || supportingSourceIds.length < 1) {
        throw new Error("Staging requires the anchor, another source, and one lead source.");
    }
    if (!sourceIds.includes(anchorPath)) {
        throw new Error(`sourceIds must include the frozen anchor path ${JSON.stringify(anchorPath)}.`);
    }
    if (supportingSourceIds.includes(anchorPath)) {
        throw new Error("unresolvedLead.supportingSourceIds must contain only non-anchor paths.");
    }
    return {
        insightMarkdown,
        sourceIds,
        unresolvedLead: {
            leadKey,
            supportingSourceIds,
            requestRelaxedRecovery: leadValue.requestRelaxedRecovery,
        },
    };
}

function stringField(value: unknown, name: string, maxLength: number): string {
    const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : "";
    if (!normalized || normalized.length > maxLength) {
        throw new Error(`${name} must be a non-empty string of at most ${maxLength} characters.`);
    }
    return normalized;
}

function stringArray(value: unknown, name: string, maxItems: number): string[] {
    if (!Array.isArray(value) || value.length > maxItems) {
        throw new Error(`${name} must be an array of at most ${maxItems} strings.`);
    }
    const normalized = value.map((item) => stringField(item, name, 512));
    if (new Set(normalized).size !== normalized.length) {
        throw new Error(`${name} must not contain duplicates.`);
    }
    return normalized;
}

function isEligibleNone(result: MemorySearchResult): boolean {
    return Boolean(result.recoverySeed)
        && result.rerankOutcome?.kind === "valid"
        && result.rerankOutcome.verdict === "none_relevant"
        && result.rerankOutcome.needsMoreEvidence === true
        && result.rerankOutcome.candidates.length === 0;
}

function isEligiblePartial(result: MemorySearchResult): boolean {
    return Boolean(result.recoverySeed)
        && result.rerankOutcome?.kind === "valid"
        && result.rerankOutcome.verdict === "partially_relevant"
        && result.rerankOutcome.needsMoreEvidence === true
        && result.rerankOutcome.candidates.length > 0;
}

function ok(observation: unknown, sourceRecords: SourceRecord[]): AgentCapabilityResult {
    return {
        status: "ok",
        observation,
        sourceRecords,
        inputSummary: "staged one provisional Pagelet insight",
        sources: sourceRecords.flatMap((record) => record.path ? [{ path: record.path }] : []),
    };
}

function unavailable(
    message: string,
    reason: ChatToolUnavailableReason,
): AgentCapabilityResult {
    return {
        status: "unavailable",
        observation: null,
        sourceRecords: [],
        inputSummary: "Pagelet insight staging unavailable",
        sources: [],
        error: message,
        userSafeMessage: message,
        unavailableReason: reason,
    };
}

function replaceBoundMemoryObservation(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
): void {
    message.content = {
        ...message.content,
        promptText: JSON.stringify({
            tool: "search_memory",
            status: "ok",
            observation: {
                status: "evidence-consolidated",
                instruction: "This bound Memory evidence is replaced by the cumulative current evidence in stage_pagelet_insight.",
            },
        }),
        previewText: "Memory evidence consolidated into the Pagelet staging result.",
        sourceRecords: [],
        contextUsed: [],
        metadata: {
            outcome: "success",
            reason: "pagelet_cumulative_replacement",
            statusOnly: true,
        },
    };
}

function memorySourceRecords(result: MemorySearchResult): SourceRecord[] {
    return result.sources.map((source) => ({
        kind: "memory-reference",
        dedupKey: createSourceDedupKey(source.path),
        providerId: "pagelet-deep-discover-host-control",
        capabilityName: PAGELET_STAGE_INSIGHT_TOOL_NAME,
        sourceBoundary: "memory",
        path: source.path,
        ...(source.score !== undefined ? { score: source.score } : {}),
        ...(source.chunkIndex !== undefined ? { chunkIndex: source.chunkIndex } : {}),
        citationEligible: true,
    }));
}

function projectPageletRecoveryEvidence(result: MemorySearchResult): Omit<
    ReturnType<typeof projectMemorySearchObservation>,
    "query"
> {
    const projected = projectMemorySearchObservation(result);
    return {
        documents: projected.documents,
        sources: projected.sources,
        hasAnswerableContent: projected.hasAnswerableContent,
        memoryEvidenceState: projected.memoryEvidenceState,
        rerankVerdict: projected.rerankVerdict,
        ...(projected.retrievalGuidance
            ? { retrievalGuidance: projected.retrievalGuidance }
            : {}),
    };
}
