import type { AgentCapability, AgentCapabilityResult } from "../../ai-services/capability-types";
import type { ChatToolContext, ChatToolName } from "../../ai-services/chat-tools";
import type { SearchMemoryInput } from "../../ai-services/chat-tool-types";
import type { ChatToolUnavailableReason, MemorySearchResult } from "../../ai-services/chat-types";
import {
    MEMORY_RECOVERY_PROJECTION_MARGIN_MS,
    mergeMemorySearchResults,
    qualifiesForRelaxedRecovery,
    resolveMemoryRecoveryDeadlineWindow,
} from "../../ai-services/retrieval-recovery-coordinator";
import type { RetrievalDiagnosticRecorder } from "../../ai-services/retrieval-diagnostics";
import { isPageletNoInsightTerminal, type PageletAgentInsightDraft, type PageletAgentRecoveryDiagnostics,
    type PageletStageValidationSubreason, type StagePageletInsightInput } from "./types";

export const PAGELET_STAGE_INSIGHT_TOOL_NAME = "stage_pagelet_insight";
const PAGELET_RECOVERY_MIN_EXECUTION_MS = 2_000;
const PAGELET_RECOVERY_MAX_ATTEMPT_MS = 10_000;

interface StageValidationResult {
    accepted: boolean;
    rejection?: "first" | "lead";
    subreason?: PageletStageValidationSubreason;
    verifiedSourceIds?: readonly string[];
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
        input: SearchMemoryInput,
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
 * Run-local complete drafts and independent run-scoped retrieval recovery.
 * Recovery policy changes affect retry admission, never completed drafts.
 */
export class PageletRecoveryCoordinator {
    private readonly staged: PageletAgentInsightDraft[] = [];
    private stageControlCalled = false;
    private tokenConsumed = false;
    private relaxedGoal?: "first_insight" | "second_insight";
    private stageValidationSubreason?: PageletStageValidationSubreason;
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

    async withMemorySearchToolCall<T>(_toolCallId: string, task: () => Promise<T>): Promise<T> {
        return await task();
    }

    async executeMemorySearch(
        input: SearchMemoryInput,
        context: ChatToolContext,
    ): Promise<MemorySearchResult> {
        const lifecycleEpoch = this.lifecycleEpoch;
        const absoluteDeadlineMs = this.memoryToolEpisodeDeadlineAt(
            context.outerToolDeadlineAt,
        );
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
                    input,
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

        if (!qualifiesForRelaxedRecovery(standard) || !standard.recoverySeed) {
            this.recordRelaxedSkipped("standard_sufficient");
            return standard;
        }
        const unavailableReason = this.relaxedUnavailableReason(absoluteDeadlineMs);
        if (unavailableReason) {
            this.recordRelaxedSkipped(unavailableReason);
            return standard;
        }

        // Claim synchronously before awaiting; staging never participates in this token.
        this.consumeToken("first_insight");
        let recovered: MemorySearchResult | null = null;
        try {
            recovered = await this.runRelaxed(standard, context, "first_insight", absoluteDeadlineMs);
        } catch (error) {
            if (!this.isCurrentLifecycle(lifecycleEpoch) || context.signal?.aborted) throw error;
        }
        if (!this.isCurrentLifecycle(lifecycleEpoch) || context.signal?.aborted) throw createAbortError();
        const candidate = this.isRecoveryPolicyCurrent() && recovered ? recovered : standard;
        if (!this.options.revalidate || (candidate.documents.length === 0 && candidate.sources.length === 0)) return candidate;
        const revalidate = async (result: MemorySearchResult) => {
            const current = await this.runBeforeDeadline(
                signal => this.options.revalidate!(result, signal),
                context.signal,
                absoluteDeadlineMs,
            );
            if (!this.isCurrentLifecycle(lifecycleEpoch) || context.signal?.aborted) throw createAbortError();
            return current;
        };
        if (candidate !== standard) {
            try {
                const current = await revalidate(candidate);
                if (current && current.memoryEvidenceState !== "unavailable" && this.isRecoveryPolicyCurrent()) return current;
            } catch (error) {
                if (!this.isCurrentLifecycle(lifecycleEpoch) || context.signal?.aborted) throw error;
            }
        }
        // A failed/late/revoked recovery cannot revive stale standard evidence.
        if (standard.documents.length === 0 && standard.sources.length === 0) return standard;
        const fallback = await revalidate(standard);
        if (!fallback) throw createDeadlineError("Pagelet Memory evidence revalidation exceeded its deadline.");
        return fallback;
    }

    reserveStageControl(raw: unknown): StagePageletInsightInput {
        if (this.disposed) throw new Error("Pagelet insight staging is unavailable.");
        const input = this.prepareStageInput(raw);
        this.stageControlCalled = true;
        return input;
    }

    discardOutput(): void {
        this.staged.length = 0;
    }

    async stage(input: StagePageletInsightInput, context: ChatToolContext): Promise<AgentCapabilityResult> {
        if (context.signal?.aborted) {
            this.stageValidationSubreason = "aborted";
            this.discardOutput();
            throw createAbortError();
        }
        if (this.disposed) return unavailable("Pagelet staging is no longer available.", "pagelet_stage_control_unavailable");
        const lifecycleEpoch = this.lifecycleEpoch;
        const absoluteDeadlineMs = this.memoryToolEpisodeDeadlineAt(context.outerToolDeadlineAt);
        let validation: StageValidationResult | null;
        try {
            validation = await this.runBeforeDeadline(
                (signal, deadline) => this.options.validateStaged(input, signal, {
                    runEpoch: this.options.runEpoch,
                    absoluteDeadlineMs: deadline,
                }),
                context.signal,
                absoluteDeadlineMs,
            );
        } catch (error) {
            if (context.signal?.aborted) {
                this.stageValidationSubreason = "aborted";
                this.discardOutput();
                throw error;
            }
            this.stageValidationSubreason = "failed";
            return unavailable("The completed text could not be validated against current evidence.", "pagelet_stage_first_rejected");
        }
        if (context.signal?.aborted) {
            this.stageValidationSubreason = "aborted";
            this.discardOutput();
            throw createAbortError();
        }
        if (!this.isCurrentLifecycle(lifecycleEpoch)) return unavailable("Pagelet staging is no longer available.", "pagelet_stage_control_unavailable");
        if (!validation) {
            this.stageValidationSubreason = "deadline";
            return unavailable("The completed text could not be validated before the deadline.", "pagelet_stage_validation_deadline");
        }
        if (validation.subreason === "aborted") {
            this.stageValidationSubreason = "aborted";
            this.discardOutput();
            return unavailable("Pagelet staging was aborted before validation completed.", "pagelet_stage_control_unavailable");
        }
        if (!validation.accepted || !validation.verifiedSourceIds?.length) {
            this.stageValidationSubreason = validation.subreason ?? "unsupported-source";
            return unavailable("The completed text is not grounded in current permitted evidence.", "pagelet_stage_first_rejected");
        }
        this.staged.push({
            body: input.insightMarkdown,
            origin: "staged",
            declaredSourceIds: [...validation.verifiedSourceIds],
        });
        return {
            status: "ok",
            observation: { status: "staged" },
            sourceRecords: [],
            inputSummary: "Staged complete Pagelet text",
            sources: [],
        };
    }

    getStageCapability(): AgentCapability {
        const name = PAGELET_STAGE_INSIGHT_TOOL_NAME as ChatToolName;
        const inputSchema = {
            type: "object" as const,
            properties: {
                insightMarkdown: {
                    type: "string" as const,
                    minLength: 1,
                    description: "Complete Markdown text to preserve for this run, unchanged.",
                },
                sourceIds: {
                    type: "array" as const,
                    items: { type: "string" as const, minLength: 1 },
                    minItems: 1,
                    uniqueItems: true,
                    description: "Exact permitted vault paths cited by and supporting this text, including the frozen anchor.",
                },
            },
            required: ["insightMarkdown", "sourceIds"],
            additionalProperties: false,
        };
        const definition = {
            name,
            description: "Optionally preserve complete source-backed Markdown during this read-only discovery run. Staging does not end exploration or write notes.",
            inputSchema,
            plannerGuidance: ["Supply the full completed text and its own exact supporting source paths."],
            permission: "read-only" as const,
            cost: "free" as const,
            outputBudgetChars: 8_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable" as const,
            statusMessage: "Preserving completed text",
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
            prepareAndValidate: raw => {
                try { return { ok: true, input: this.prepareStageInput(raw) }; }
                catch (error) { return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }; }
            },
            toProviderSchema: () => ({ type: "function", function: { name, description: definition.description, parameters: inputSchema } }),
            toRegistryDefinition: () => ({ ...definition }),
            execute: async (raw, context) => {
                let input: StagePageletInsightInput;
                try { input = this.reserveStageControl(raw); }
                catch (error) { return unavailable(error instanceof Error ? error.message : String(error), "pagelet_stage_control_unavailable"); }
                return this.stage(input, {
                    host: context.host,
                    signal: context.signal,
                    outerToolDeadlineAt: context.outerToolDeadlineAt,
                });
            },
        };
    }

    snapshot(finalText: string): PageletRecoverySnapshot {
        const drafts = this.staged.map(draft => ({ ...draft, declaredSourceIds: [...draft.declaredSourceIds] }));
        if (finalText.trim() && !isPageletNoInsightTerminal(finalText)) {
            drafts.push({ body: finalText, origin: "terminal", declaredSourceIds: [] });
        }
        return {
            drafts,
            diagnostics: {
                enabled: this.options.enabled,
                stageControlCalled: this.stageControlCalled,
                relaxedTokenConsumed: this.tokenConsumed,
                ...(this.relaxedGoal ? { relaxedGoal: this.relaxedGoal } : {}),
                ...(this.stageValidationSubreason ? { stageValidationSubreason: this.stageValidationSubreason } : {}),
            },
        };
    }

    hasStagedInsight(): boolean { return this.staged.length > 0; }

    private prepareStageInput(raw: unknown): StagePageletInsightInput {
        try {
            const input = validateStageInput(raw, this.options.anchorPath);
            this.options.prevalidateStaged(input);
            return input;
        } catch (error) {
            this.stageValidationSubreason = "shape";
            throw error;
        }
    }

    clear(): void {
        this.disposed = true;
        this.lifecycleEpoch += 1;
        this.unsubscribePolicy?.();
        this.unsubscribePolicy = undefined;
        for (const controller of this.activeChildControllers) controller.abort();
        this.activeChildControllers.clear();
        this.activeRecoveryControllers.clear();
        this.discardOutput();
        this.stageControlCalled = false;
        this.tokenConsumed = false;
        this.relaxedGoal = undefined;
    }

    private relaxedUnavailableReason(absoluteDeadlineMs?: number): string | undefined {
        if (this.disposed) return "coordinator_closed";
        if (!this.isRecoveryPolicyCurrent()) return "flag_off";
        if (this.tokenConsumed) return "token_consumed";
        if (!this.options.executeRelaxed) return "executor_unavailable";
        const recoveryDeadlineAt = Math.min(
            this.softDeadlineAt(),
            absoluteDeadlineMs ?? Number.POSITIVE_INFINITY,
        );
        const remainingMs = recoveryDeadlineAt - this.options.now();
        const allowed = remainingMs >= PAGELET_RECOVERY_MIN_EXECUTION_MS;
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
        absoluteDeadlineMs?: number,
    ): Promise<MemorySearchResult | null> {
        if (!this.options.executeRelaxed) return null;
        const startedAt = this.recordDiagnostic ? this.options.now() : 0;
        this.recordDiagnostic?.({
            phase: "recovery_relaxed",
            outcome: "started",
            metrics: {
                retryConsumed: 1,
                remainingMs: Math.max(0, Math.min(
                    this.softDeadlineAt(),
                    absoluteDeadlineMs ?? Number.POSITIVE_INFINITY,
                ) - startedAt),
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
                absoluteDeadlineMs,
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
        absoluteDeadlineCeilingMs?: number,
    ): Promise<T | null> {
        const softAt = Math.min(
            this.softDeadlineAt(),
            absoluteDeadlineCeilingMs ?? Number.POSITIVE_INFINITY,
        );
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
            if (parentSignal?.aborted) throw createAbortError();
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
    }

    private isCurrentLifecycle(epoch: number): boolean {
        return !this.disposed && this.lifecycleEpoch === epoch;
    }

    private softDeadlineAt(): number {
        return this.runSoftDeadlineAt() - MEMORY_RECOVERY_PROJECTION_MARGIN_MS;
    }

    private runSoftDeadlineAt(): number {
        return this.hardDeadlineAt() - this.options.finalizationReserveMs;
    }

    private hardDeadlineAt(): number {
        return this.options.startedAt + this.options.maxWallClockMs;
    }

    private memoryToolEpisodeDeadlineAt(outerToolDeadlineAt?: number): number {
        const invocationStartedAt = this.options.now();
        return resolveMemoryRecoveryDeadlineWindow({
            invocationStartedAt,
            outerToolDeadlineAt,
            toolAt: this.runSoftDeadlineAt(),
            softAt: this.runSoftDeadlineAt(),
            hardAt: this.hardDeadlineAt(),
        }).episodeAt;
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

function validateStageInput(raw: unknown, anchorPath: string): StagePageletInsightInput {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("stage_pagelet_insight input must be an object.");
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => key !== "insightMarkdown" && key !== "sourceIds")) {
        throw new Error("stage_pagelet_insight accepts only insightMarkdown and sourceIds.");
    }
    if (typeof value.insightMarkdown !== "string" || !value.insightMarkdown.trim()) {
        throw new Error("insightMarkdown must be a non-empty string.");
    }
    if (!Array.isArray(value.sourceIds) || !value.sourceIds.length
        || value.sourceIds.some(path => typeof path !== "string" || !path.trim())) {
        throw new Error("sourceIds must contain non-empty exact vault paths.");
    }
    const sourceIds = value.sourceIds as string[];
    if (new Set(sourceIds).size !== sourceIds.length) throw new Error("sourceIds must not contain duplicates.");
    if (!sourceIds.includes(anchorPath)) throw new Error("sourceIds must include the frozen anchor path.");
    return { insightMarkdown: value.insightMarkdown, sourceIds: [...sourceIds] };
}

function unavailable(message: string, reason: ChatToolUnavailableReason): AgentCapabilityResult {
    return {
        status: "unavailable",
        observation: null,
        sourceRecords: [],
        inputSummary: "Pagelet text staging unavailable",
        sources: [],
        error: message,
        userSafeMessage: message,
        unavailableReason: reason,
    };
}
