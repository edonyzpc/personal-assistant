import { normalizeVaultPath } from "../pa/helpers";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import type {
    ChatToolResult,
    MemoryCandidate,
    MemorySearchDocument,
    MemorySearchRecoverySeed,
    MemorySearchResult,
    MemoryTemporalFilter,
    MemoryTemporalProjectionAudit,
    SourceRecord,
} from "./chat-types";
import { createAbortError } from "./chat-utils";
import { isSearchMemoryResult } from "./chat-tool-guards";
import { allocateMemoryDocumentsTwoPass } from "./memory-search-tool";
import type { QueryTemporalIntent } from "./query-rewriter";
import type { RetrievalDiagnosticRecorder } from "./retrieval-diagnostics";

export const MEMORY_RECOVERY_EPISODE_BUDGET_MS = 30_000;
const DEFAULT_RELAXED_ATTEMPT_BUDGET_MS = 10_000;
const DEFAULT_MINIMUM_RELAXED_BUDGET_MS = 2_000;
export const MEMORY_RECOVERY_PROJECTION_MARGIN_MS = 500;
export const MEMORY_RECOVERY_HOST_SETTLEMENT_MARGIN_MS = 250;
const MIN_REASONABLE_EXPLICIT_YEAR = 1900;
const MAX_REASONABLE_EXPLICIT_YEAR = 2199;

export type MemoryRecoveryAttempt =
    | {
        mode: "standard";
        invocationOrdinal: number;
        temporalIntent: QueryTemporalIntent;
        captureRecoverySeed: boolean;
        runEpoch: string;
        absoluteDeadlineMs: number;
    }
    | {
        mode: "relaxed";
        invocationOrdinal: number;
        seed: MemorySearchRecoverySeed;
        runEpoch: string;
        absoluteDeadlineMs: number;
    };

export interface ChatMemoryRecoveryCoordinatorOptions {
    runId: string;
    runEpoch: string;
    hardAt: number;
    softAt: number;
    toolAt: number;
    signal?: AbortSignal;
    enabled: boolean;
    policyEpoch?: string;
    isEnabled?: () => boolean;
    getPolicyEpoch?: () => string;
    onPolicyChanged?: (listener: () => void | Promise<void>) => () => void;
    temporalIntent: QueryTemporalIntent;
    now?: () => number;
    memoryEpisodeBudgetMs?: number;
    relaxedAttemptBudgetMs?: number;
    minimumRelaxedBudgetMs?: number;
    projectionMarginMs?: number;
    hostSettlementMarginMs?: number;
    recordDiagnostic?: RetrievalDiagnosticRecorder;
}

export interface ChatMemoryRecoveryExecution {
    query: string;
    signal: AbortSignal;
    /** Absolute timeout boundary registered by the outer Tool dispatcher. */
    outerToolDeadlineAt?: number;
    executeAttempt(
        attempt: MemoryRecoveryAttempt,
        signal: AbortSignal,
    ): Promise<ChatToolResult<unknown>>;
    revalidate(
        result: MemorySearchResult,
        signal: AbortSignal,
        temporalFilter?: MemoryTemporalFilter | null,
        temporalAudit?: MemoryTemporalProjectionAudit,
    ): Promise<MemorySearchResult>;
}

export interface MemoryRecoveryDeadlineWindowInput {
    invocationStartedAt: number;
    outerToolDeadlineAt?: number;
    toolAt: number;
    softAt: number;
    hardAt: number;
    memoryEpisodeBudgetMs?: number;
    projectionMarginMs?: number;
    hostSettlementMarginMs?: number;
}

export interface MemoryRecoveryDeadlineWindow {
    outerToolDeadlineAt: number;
    hostSettlementAt: number;
    episodeAt: number;
}

/**
 * Resolve the Host-owned deadline window shared by Chat and Pagelet Memory
 * episodes. The outer Tool timer starts before capability execution, so every
 * inner attempt must preserve both projection and Host-settlement time instead
 * of starting a fresh timeout clock.
 */
export function resolveMemoryRecoveryDeadlineWindow(
    input: MemoryRecoveryDeadlineWindowInput,
): MemoryRecoveryDeadlineWindow {
    const memoryEpisodeBudgetMs = normalizePositiveMs(
        input.memoryEpisodeBudgetMs,
        MEMORY_RECOVERY_EPISODE_BUDGET_MS,
    );
    const projectionMarginMs = normalizePositiveMs(
        input.projectionMarginMs,
        MEMORY_RECOVERY_PROJECTION_MARGIN_MS,
    );
    const hostSettlementMarginMs = normalizePositiveMs(
        input.hostSettlementMarginMs,
        MEMORY_RECOVERY_HOST_SETTLEMENT_MARGIN_MS,
    );
    const outerToolDeadlineAt = typeof input.outerToolDeadlineAt === "number"
        && Number.isFinite(input.outerToolDeadlineAt)
        ? input.outerToolDeadlineAt
        : input.invocationStartedAt + memoryEpisodeBudgetMs;
    const hostSettlementAt = Math.min(
        input.toolAt,
        input.softAt,
        input.hardAt,
        input.invocationStartedAt + memoryEpisodeBudgetMs,
        outerToolDeadlineAt,
    ) - hostSettlementMarginMs;
    return {
        outerToolDeadlineAt,
        hostSettlementAt,
        episodeAt: hostSettlementAt - projectionMarginMs,
    };
}

type RecoveryTokenState = "available" | "consumed" | "closed";

class MemoryRecoveryAttemptDeadlineError extends Error {
    constructor() {
        super("Memory recovery attempt exceeded its Host deadline.");
        this.name = "MemoryRecoveryAttemptDeadlineError";
    }
}

class MemoryRecoveryProjectionDeadlineError extends Error {
    constructor() {
        super("Memory recovery projection exceeded its Host deadline.");
        this.name = "MemoryRecoveryProjectionDeadlineError";
    }
}

/**
 * Per-Agent-Run owner for Chat's single hidden same-query recovery attempt.
 * The search tool remains invocation-stateless; all token/deadline/ledger state
 * is destroyed when this coordinator closes.
 */
export class ChatMemoryRecoveryCoordinator {
    private readonly now: () => number;
    private readonly activeControllers = new Set<AbortController>();
    private readonly activeRecoveryControllers = new Set<AbortController>();
    private readonly abortFromRun = () => this.close();
    private readonly initialPolicyEpoch?: string;
    private readonly recordDiagnostic?: RetrievalDiagnosticRecorder;
    private unsubscribePolicy?: () => void;
    private token: RecoveryTokenState = "available";
    private nextInvocationOrdinal = 0;
    private closed = false;
    private recoveryDisabled = false;

    constructor(private readonly options: ChatMemoryRecoveryCoordinatorOptions) {
        this.now = options.now ?? Date.now;
        this.recordDiagnostic = createSafeDiagnosticRecorder(options.recordDiagnostic);
        this.initialPolicyEpoch = options.policyEpoch ?? options.getPolicyEpoch?.();
        options.signal?.addEventListener("abort", this.abortFromRun, { once: true });
        if (options.enabled) {
            this.unsubscribePolicy = options.onPolicyChanged?.(() => {
                if (!this.isRecoveryPolicyCurrent()) this.disableRecovery();
            });
            if (!this.isRecoveryPolicyCurrent()) this.disableRecovery();
        }
        if (options.signal?.aborted) this.close();
    }

    async execute(input: ChatMemoryRecoveryExecution): Promise<ChatToolResult<unknown>> {
        if (this.closed || input.signal.aborted) throw createAbortError();
        const invocationOrdinal = this.allocateInvocationOrdinal();
        const recordDiagnostic: RetrievalDiagnosticRecorder | undefined = this.recordDiagnostic
            ? (event) => this.recordDiagnostic?.({
                ...event,
                ...(event.phase === "finalization_reserve"
                    && !(event.outcome === "skipped" && event.reason === "reserve_protected")
                    ? {}
                    : { invocationOrdinal }),
            })
            : undefined;
        const invocationStartedAt = this.now();
        // The dispatcher's generic tool timer is registered before Host execution
        // starts. Keep every Recovery terminal (including projection fallback)
        // content-independently ahead of that timer instead of racing it at the
        // same 30s boundary. The projection margin remains a separate child-work
        // reserve inside this Host settlement boundary.
        const { hostSettlementAt, episodeAt } = resolveMemoryRecoveryDeadlineWindow({
            invocationStartedAt,
            outerToolDeadlineAt: input.outerToolDeadlineAt,
            toolAt: this.options.toolAt,
            softAt: this.options.softAt,
            hardAt: this.options.hardAt,
            memoryEpisodeBudgetMs: this.memoryEpisodeBudgetMs,
            projectionMarginMs: this.projectionMarginMs,
            hostSettlementMarginMs: this.hostSettlementMarginMs,
        });
        let standard: ChatToolResult<unknown>;
        const standardStartedAt = recordDiagnostic ? this.now() : 0;
        recordDiagnostic?.({
            phase: "recovery_standard",
            outcome: "started",
            metrics: { remainingMs: Math.max(0, episodeAt - standardStartedAt) },
        });
        try {
            standard = await this.runAttempt(
                {
                    mode: "standard",
                    invocationOrdinal,
                    temporalIntent: this.options.temporalIntent,
                    captureRecoverySeed: this.isRecoveryPolicyCurrent(),
                    runEpoch: this.options.runEpoch,
                    absoluteDeadlineMs: episodeAt,
                },
                input,
                episodeAt,
            );
        } catch (error) {
            if (this.closed || input.signal.aborted || this.options.signal?.aborted) {
                recordDiagnostic?.({
                    phase: "recovery_standard",
                    outcome: "aborted",
                    reason: "attempt_aborted",
                    metrics: { durationMs: this.now() - standardStartedAt },
                });
                throw createAbortError();
            }
            if (error instanceof MemoryRecoveryAttemptDeadlineError) {
                recordDiagnostic?.({
                    phase: "recovery_standard",
                    outcome: "deadline",
                    reason: "attempt_deadline",
                    metrics: { durationMs: this.now() - standardStartedAt },
                });
                return createMemoryRecoveryTimeoutResult(input.query);
            }
            if (isAbortLike(error)) {
                recordDiagnostic?.({
                    phase: "recovery_standard",
                    outcome: "aborted",
                    reason: "attempt_aborted",
                    metrics: { durationMs: this.now() - standardStartedAt },
                });
                return createMemoryRecoveryUnavailableResult(input.query);
            }
            recordDiagnostic?.({
                phase: "recovery_standard",
                outcome: "failed",
                reason: "attempt_failed",
                metrics: { durationMs: this.now() - standardStartedAt },
            });
            throw error;
        }
        const standardDiagnostic = classifyMemoryRecoveryTerminal(
            standard,
            "standard_unavailable",
        );
        recordDiagnostic?.({
            phase: "recovery_standard",
            outcome: standardDiagnostic.outcome,
            ...(standardDiagnostic.reason ? { reason: standardDiagnostic.reason } : {}),
            metrics: {
                durationMs: this.now() - standardStartedAt,
                ...(standardDiagnostic.documentCount === undefined
                    ? {}
                    : { documentCount: standardDiagnostic.documentCount }),
            },
        });
        const recoveryPolicyCurrent = this.isRecoveryPolicyCurrent();
        if (
            !recoveryPolicyCurrent
            || !isSuccessfulMemoryResult(standard)
            || standard.content.memoryEvidenceState === "unavailable"
        ) {
            if (this.options.enabled && !recoveryPolicyCurrent) this.disableRecovery();
            recordDiagnostic?.({
                phase: "recovery_relaxed",
                outcome: "skipped",
                reason: recoveryPolicyCurrent ? "standard_unavailable" : "flag_off",
            });
            return stripRecoverySeed(
                standard,
                recoveryPolicyCurrent ? undefined : "recovery_disabled",
            );
        }

        const standardMemory = standard.content;
        if (!qualifiesForRelaxedRecovery(standardMemory)) {
            recordDiagnostic?.({ phase: "recovery_relaxed", outcome: "skipped", reason: "not_eligible" });
            return stripRecoverySeed(standard);
        }
        const seed = standardMemory.recoverySeed;
        if (!seed || seed.query !== input.query || !seed.queryEmbedding) {
            recordDiagnostic?.({ phase: "recovery_relaxed", outcome: "skipped", reason: "seed_unavailable" });
            return stripRecoverySeed(standard);
        }

        const relaxedAt = Math.min(episodeAt, this.now() + this.relaxedAttemptBudgetMs);
        if (this.token !== "available") {
            recordDiagnostic?.({
                phase: "recovery_relaxed",
                outcome: "skipped",
                reason: this.token === "consumed" ? "token_consumed" : "coordinator_closed",
            });
            return stripRecoverySeed(standard);
        }
        if (relaxedAt - this.now() < this.minimumRelaxedBudgetMs + this.projectionMarginMs) {
            recordDiagnostic?.({
                phase: "finalization_reserve",
                outcome: "skipped",
                reason: "reserve_protected",
                metrics: { remainingMs: Math.max(0, relaxedAt - this.now()) },
            });
            return stripRecoverySeed(standard, "recovery_skipped_deadline");
        }

        // JS execution is single-threaded between awaits: this transition is the
        // synchronous atomic claim. The token is consumed at attempt start and is
        // never restored for none/error/timeout/abort.
        this.token = "consumed";
        let relaxed: ChatToolResult<unknown> | undefined;
        const relaxedStartedAt = recordDiagnostic ? this.now() : 0;
        recordDiagnostic?.({
            phase: "recovery_relaxed",
            outcome: "started",
            metrics: { remainingMs: Math.max(0, relaxedAt - relaxedStartedAt), retryConsumed: 1 },
        });
        try {
            relaxed = await this.runAttempt({
                mode: "relaxed",
                invocationOrdinal,
                seed,
                runEpoch: this.options.runEpoch,
                absoluteDeadlineMs: relaxedAt,
            }, input, relaxedAt);
        } catch (error) {
            if (this.closed || input.signal.aborted || this.options.signal?.aborted) {
                recordDiagnostic?.({
                    phase: "recovery_relaxed",
                    outcome: "aborted",
                    reason: "attempt_aborted",
                    metrics: { durationMs: this.now() - relaxedStartedAt, retryConsumed: 1 },
                });
                throw createAbortError();
            }
            const attemptDeadlineExpired = error instanceof MemoryRecoveryAttemptDeadlineError;
            recordDiagnostic?.({
                phase: "recovery_relaxed",
                outcome: attemptDeadlineExpired ? "deadline" : isAbortLike(error) ? "aborted" : "failed",
                reason: attemptDeadlineExpired
                    ? "attempt_deadline"
                    : isAbortLike(error) ? "attempt_aborted" : "attempt_failed",
                metrics: { durationMs: this.now() - relaxedStartedAt, retryConsumed: 1 },
            });
            return stripRecoverySeed(
                standard,
                this.isRecoveryPolicyCurrent() ? undefined : "recovery_disabled",
            );
        }
        const relaxedDiagnostic = classifyMemoryRecoveryTerminal(
            relaxed,
            "source_unavailable",
        );
        recordDiagnostic?.({
            phase: "recovery_relaxed",
            outcome: relaxedDiagnostic.outcome,
            ...(relaxedDiagnostic.reason ? { reason: relaxedDiagnostic.reason } : {}),
            metrics: {
                durationMs: this.now() - relaxedStartedAt,
                retryConsumed: 1,
                ...(relaxedDiagnostic.documentCount === undefined
                    ? {}
                    : { documentCount: relaxedDiagnostic.documentCount }),
            },
        });
        if (!this.isRecoveryPolicyCurrent()) return stripRecoverySeed(standard, "recovery_disabled");
        if (!isSuccessfulMemoryResult(relaxed)) return stripRecoverySeed(standard);

        const cumulative = mergeMemorySearchResults(standardMemory, relaxed.content);
        let current: MemorySearchResult;
        const projectionStartedAt = recordDiagnostic ? this.now() : 0;
        const temporalAudit: MemoryTemporalProjectionAudit = {
            // A ranged projection starts fail-closed. Only the Memory host's
            // actual revalidation/filter pass may replace this sentinel with 1/0.
            temporalFilterApplied: 0,
            temporalViolationCount: seed.lexicalPlan.temporalFilter ? 1 : 0,
        };
        recordDiagnostic?.({
            phase: "recovery_projection",
            outcome: "started",
            metrics: {
                temporalFilterApplied: temporalAudit.temporalFilterApplied,
            },
        });
        try {
            current = await this.runProjection(
                cumulative,
                input,
                hostSettlementAt,
                seed.lexicalPlan.temporalFilter,
                temporalAudit,
            );
        } catch (error) {
            if (input.signal.aborted || this.options.signal?.aborted || this.closed) {
                recordDiagnostic?.({
                    phase: "recovery_projection",
                    outcome: "aborted",
                    reason: "projection_aborted",
                    metrics: {
                        durationMs: this.now() - projectionStartedAt,
                        ...temporalAudit,
                    },
                });
                throw createAbortError();
            }
            const projectionDeadlineExpired = error instanceof MemoryRecoveryProjectionDeadlineError;
            recordDiagnostic?.({
                phase: "recovery_projection",
                outcome: projectionDeadlineExpired ? "deadline" : isAbortLike(error) ? "aborted" : "failed",
                reason: projectionDeadlineExpired
                    ? "projection_deadline"
                    : isAbortLike(error) ? "projection_aborted" : "projection_failed",
                metrics: {
                    durationMs: this.now() - projectionStartedAt,
                    ...temporalAudit,
                },
            });
            return stripRecoverySeed(standard);
        }
        const projectionUnavailable = current.memoryEvidenceState === "unavailable";
        const projectionDocumentDiagnostic = completedMemoryDocumentDiagnostic(current);
        recordDiagnostic?.({
            phase: "recovery_projection",
            outcome: projectionUnavailable ? "fallback" : "completed",
            ...(projectionUnavailable
                ? { reason: "projection_unavailable" }
                : projectionDocumentDiagnostic.reason
                    ? { reason: projectionDocumentDiagnostic.reason }
                    : {}),
            metrics: {
                durationMs: this.now() - projectionStartedAt,
                ...(projectionUnavailable || projectionDocumentDiagnostic.documentCount === undefined
                    ? {}
                    : { documentCount: projectionDocumentDiagnostic.documentCount }),
                ...temporalAudit,
            },
        });
        if (this.closed || input.signal.aborted) throw createAbortError();
        if (!this.isRecoveryPolicyCurrent()) return stripRecoverySeed(standard, "recovery_disabled");
        return {
            ...standard,
            content: stripMemoryRecoveryState(current),
            sources: current.sources,
            sourceRecords: mergeCurrentMemorySourceRecords(
                standard.sourceRecords ?? [],
                relaxed.sourceRecords ?? [],
                current.documents,
            ),
        };
    }

    private allocateInvocationOrdinal(): number {
        const ordinal = this.nextInvocationOrdinal;
        if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
            throw new Error("Memory recovery invocation ordinal exhausted.");
        }
        this.nextInvocationOrdinal = ordinal + 1;
        return ordinal;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.token = "closed";
        this.unsubscribePolicy?.();
        this.unsubscribePolicy = undefined;
        this.options.signal?.removeEventListener("abort", this.abortFromRun);
        for (const controller of this.activeControllers) controller.abort();
        this.activeControllers.clear();
        this.activeRecoveryControllers.clear();
    }

    /** Test/diagnostic seam; contains no query, path, or evidence content. */
    getState(): { token: RecoveryTokenState; closed: boolean; activeAttemptCount: number } {
        return {
            token: this.token,
            closed: this.closed,
            activeAttemptCount: this.activeControllers.size,
        };
    }

    private async runAttempt(
        attempt: MemoryRecoveryAttempt,
        input: ChatMemoryRecoveryExecution,
        deadlineAt: number,
    ): Promise<ChatToolResult<unknown>> {
        if (this.closed || input.signal.aborted) throw createAbortError();
        if (deadlineAt <= this.now()) throw new MemoryRecoveryAttemptDeadlineError();
        const controller = new AbortController();
        const abort = () => controller.abort();
        input.signal.addEventListener("abort", abort, { once: true });
        this.options.signal?.addEventListener("abort", abort, { once: true });
        let deadlineExpired = false;
        let timer: PlatformTimeoutHandle | undefined = setPlatformTimeout(
            () => {
                deadlineExpired = true;
                controller.abort();
            },
            Math.max(0, deadlineAt - this.now()),
        );
        this.activeControllers.add(controller);
        if (attempt.mode === "relaxed") this.activeRecoveryControllers.add(controller);
        try {
            const task = Promise.resolve().then(() => input.executeAttempt(attempt, controller.signal));
            const taggedTask = task.then(
                (value) => ({ type: "completed" as const, value }),
                (error) => ({ type: "rejected" as const, error }),
            );
            const interrupted = new Promise<{ type: "interrupted" }>((resolve) => {
                if (controller.signal.aborted) {
                    resolve({ type: "interrupted" });
                    return;
                }
                controller.signal.addEventListener("abort", () => resolve({ type: "interrupted" }), { once: true });
            });
            const result = await Promise.race([taggedTask, interrupted]);
            if (result.type === "completed") return result.value;
            if (result.type === "rejected") {
                if (deadlineExpired && !input.signal.aborted && !this.options.signal?.aborted && !this.closed) {
                    throw new MemoryRecoveryAttemptDeadlineError();
                }
                throw result.error;
            }
            if (deadlineExpired && !input.signal.aborted && !this.options.signal?.aborted && !this.closed) {
                throw new MemoryRecoveryAttemptDeadlineError();
            }
            throw createAbortError();
        } finally {
            if (timer !== undefined) {
                clearPlatformTimeout(timer);
                timer = undefined;
            }
            input.signal.removeEventListener("abort", abort);
            this.options.signal?.removeEventListener("abort", abort);
            this.activeControllers.delete(controller);
            this.activeRecoveryControllers.delete(controller);
        }
    }

    private async runProjection(
        result: MemorySearchResult,
        input: ChatMemoryRecoveryExecution,
        deadlineAt: number,
        temporalFilter: MemoryTemporalFilter | null,
        temporalAudit: MemoryTemporalProjectionAudit,
    ): Promise<MemorySearchResult> {
        if (this.closed || input.signal.aborted) throw createAbortError();
        if (deadlineAt <= this.now()) throw new MemoryRecoveryProjectionDeadlineError();
        const controller = new AbortController();
        const abort = () => controller.abort();
        input.signal.addEventListener("abort", abort, { once: true });
        this.options.signal?.addEventListener("abort", abort, { once: true });
        let deadlineExpired = false;
        let timer: PlatformTimeoutHandle | undefined = setPlatformTimeout(
            () => {
                deadlineExpired = true;
                controller.abort();
            },
            Math.max(0, deadlineAt - this.now()),
        );
        this.activeControllers.add(controller);
        this.activeRecoveryControllers.add(controller);
        try {
            const task = Promise.resolve().then(() => input.revalidate(
                result,
                controller.signal,
                temporalFilter,
                temporalAudit,
            ));
            const taggedTask = task.then(
                (value) => ({ type: "completed" as const, value }),
                (error) => ({ type: "rejected" as const, error }),
            );
            const interrupted = new Promise<{ type: "interrupted" }>((resolve) => {
                if (controller.signal.aborted) {
                    resolve({ type: "interrupted" });
                    return;
                }
                controller.signal.addEventListener("abort", () => resolve({ type: "interrupted" }), { once: true });
            });
            const projected = await Promise.race([taggedTask, interrupted]);
            if (projected.type === "completed") return projected.value;
            if (projected.type === "rejected") {
                if (deadlineExpired && !input.signal.aborted && !this.options.signal?.aborted && !this.closed) {
                    throw new MemoryRecoveryProjectionDeadlineError();
                }
                throw projected.error;
            }
            if (deadlineExpired && !input.signal.aborted && !this.options.signal?.aborted && !this.closed) {
                throw new MemoryRecoveryProjectionDeadlineError();
            }
            throw createAbortError();
        } finally {
            if (timer !== undefined) {
                clearPlatformTimeout(timer);
                timer = undefined;
            }
            input.signal.removeEventListener("abort", abort);
            this.options.signal?.removeEventListener("abort", abort);
            this.activeControllers.delete(controller);
            this.activeRecoveryControllers.delete(controller);
        }
    }

    private isRecoveryPolicyCurrent(): boolean {
        if (this.closed || this.recoveryDisabled || !this.options.enabled) return false;
        if (this.options.isEnabled && !this.options.isEnabled()) return false;
        return this.initialPolicyEpoch === undefined
            || this.options.getPolicyEpoch === undefined
            || this.options.getPolicyEpoch() === this.initialPolicyEpoch;
    }

    private disableRecovery(): void {
        if (this.recoveryDisabled) return;
        this.recoveryDisabled = true;
        this.token = "closed";
        this.unsubscribePolicy?.();
        this.unsubscribePolicy = undefined;
        for (const controller of this.activeRecoveryControllers) controller.abort();
        this.activeRecoveryControllers.clear();
    }

    private get memoryEpisodeBudgetMs(): number {
        return normalizePositiveMs(
            this.options.memoryEpisodeBudgetMs,
            MEMORY_RECOVERY_EPISODE_BUDGET_MS,
        );
    }

    private get relaxedAttemptBudgetMs(): number {
        return normalizePositiveMs(this.options.relaxedAttemptBudgetMs, DEFAULT_RELAXED_ATTEMPT_BUDGET_MS);
    }

    private get minimumRelaxedBudgetMs(): number {
        return normalizePositiveMs(this.options.minimumRelaxedBudgetMs, DEFAULT_MINIMUM_RELAXED_BUDGET_MS);
    }

    private get projectionMarginMs(): number {
        return normalizePositiveMs(
            this.options.projectionMarginMs,
            MEMORY_RECOVERY_PROJECTION_MARGIN_MS,
        );
    }

    private get hostSettlementMarginMs(): number {
        return normalizePositiveMs(
            this.options.hostSettlementMarginMs,
            MEMORY_RECOVERY_HOST_SETTLEMENT_MARGIN_MS,
        );
    }
}

function createMemoryRecoveryTimeoutResult(query: string): ChatToolResult<null> {
    return {
        ok: false,
        tool: "search_memory",
        inputSummary: query,
        content: null,
        sources: [],
        error: "Memory retrieval timed out before the final-answer reserve.",
    };
}

function createMemoryRecoveryUnavailableResult(query: string): ChatToolResult<null> {
    return {
        ok: false,
        tool: "search_memory",
        inputSummary: query,
        content: null,
        sources: [],
        error: "Memory retrieval became unavailable before completion.",
    };
}

function isAbortLike(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function createSafeDiagnosticRecorder(
    recorder: RetrievalDiagnosticRecorder | undefined,
): RetrievalDiagnosticRecorder | undefined {
    if (!recorder) return undefined;
    return (event) => {
        try {
            recorder(event);
        } catch {
            // Measurement must never affect recovery.
        }
    };
}

export function captureExplicitTemporalIntent(query: string): QueryTemporalIntent {
    const normalized = query.trim().toLowerCase();
    if (/(?:\blast\s*7\s*days?\b|\bpast\s*7\s*days?\b|最近\s*7\s*天|近\s*7\s*天)/i.test(query)) {
        return "recent_7d";
    }
    if (/(?:\blast\s*30\s*days?\b|\bpast\s*30\s*days?\b|最近\s*30\s*天|近\s*30\s*天)/i.test(query)) {
        return "recent_30d";
    }
    const dates = [...query.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)]
        .map((match) => match[1])
        .filter((value) => !Number.isNaN(Date.parse(value)));
    if (dates.length >= 2 && Date.parse(dates[0]) <= Date.parse(dates[1])) {
        return `range:${dates[0]}..${dates[1]}`;
    }
    if (dates.length === 1) return `range:${dates[0]}..${dates[0]}`;
    const standaloneYears = [...query.matchAll(/(?:^|[^\p{L}\p{N}_-])(\d{4})(?![\p{L}\p{N}_-])/gu)];
    const chineseSuffixedYears = [
        ...query.matchAll(/(?:^|[^A-Za-z0-9_-])(\d{4})\s*(?:年度|年(?!度))(?![_-])/g),
    ];
    const years = [...standaloneYears, ...chineseSuffixedYears]
        .map((match) => match[1])
        .filter((year) => {
            const value = Number(year);
            return value >= MIN_REASONABLE_EXPLICIT_YEAR
                && value <= MAX_REASONABLE_EXPLICIT_YEAR;
        });
    const distinctYears = [...new Set(years)];
    if (distinctYears.length === 1) {
        const year = distinctYears[0];
        return `range:${year}-01-01..${year}-12-31`;
    }
    const hasContextualCurrentIntent =
        /\bcurrent\s+(?:work|progress|updates?|activity|time|date|year|month|week|day)\b/.test(normalized)
        || /当前(?:的)?(?:工作|进展|更新|动态|时间|日期|年份|年度|月份|星期|本周|今天)/.test(query);
    if (
        /\b(today|this week|latest|recent|recently|now)\b/.test(normalized)
        || /(?:今天|本周|最近|近期|最新|现在)/.test(query)
        || hasContextualCurrentIntent
    ) return "recent_30d";
    if (/\b(yesterday|last week)\b/.test(normalized) || /(?:昨天|上周)/.test(query)) {
        return "recent_7d";
    }
    return "none";
}

export function qualifiesForRelaxedRecovery(result: MemorySearchResult): boolean {
    const outcome = result.rerankOutcome;
    if (!outcome || outcome.kind !== "valid") return false;
    if (result.memoryEvidenceState === "none") {
        return outcome.verdict === "none_relevant";
    }
    return result.memoryEvidenceState === "partial"
        && outcome.verdict === "partially_relevant"
        && outcome.needsMoreEvidence === true;
}

export function mergeMemorySearchResults(
    standard: MemorySearchResult,
    relaxed: MemorySearchResult,
): MemorySearchResult {
    if (!hasUsableRelaxedEvidence(relaxed)) return stripMemoryRecoveryState(standard);
    const standardCandidates = standard.candidates ?? [];
    const relaxedCandidates = relaxed.candidates ?? [];
    const relaxedIsFailOpen = relaxed.rerankOutcome?.kind === "fail_open";
    const ordered = relaxedIsFailOpen
        ? [...standardCandidates, ...relaxedCandidates]
        : interleave(standardCandidates, relaxedCandidates);
    const candidates = dedupeCandidatesPreferRelaxed(ordered, relaxedCandidates);
    const documents = allocateMemoryDocumentsTwoPass(candidates, 8);
    if (documents.length === 0) return stripMemoryRecoveryState(standard);
    const sources = documents.map((document) => ({ ...document.source }));
    const partial = relaxed.rerankOutcome?.kind === "valid"
        ? relaxed.rerankOutcome.verdict === "partially_relevant"
        : standard.memoryEvidenceState === "partial";
    return {
        ...standard,
        usedMemory: true,
        documents,
        sources,
        candidates,
        hasAnswerableContent: true,
        needsSnippetFollowup: false,
        memoryEvidenceState: partial ? "partial" : "evidence",
        rerankVerdict: partial ? "partially_relevant" : "relevant",
        needsMoreEvidence: partial,
        ...(partial
            ? { retrievalGuidance: "The selected Memory evidence is partial; do not fill missing facts by inference." }
            : { retrievalGuidance: undefined }),
        rerankOutcome: relaxed.rerankOutcome?.kind === "valid"
            ? relaxed.rerankOutcome
            : standard.rerankOutcome,
        recoverySeed: undefined,
        recoveryReason: undefined,
        operationalReason: undefined,
    };
}

function hasUsableRelaxedEvidence(result: MemorySearchResult): boolean {
    return result.memoryEvidenceState !== "none"
        && result.memoryEvidenceState !== "unavailable"
        && result.documents.length > 0
        && (result.candidates?.length ?? 0) > 0;
}

function isSuccessfulMemoryResult(
    result: ChatToolResult<unknown>,
): result is Omit<ChatToolResult<MemorySearchResult>, "content"> & { content: MemorySearchResult } {
    return result.ok && isSearchMemoryResult(result.content);
}

function classifyMemoryRecoveryTerminal(
    result: ChatToolResult<unknown>,
    unavailableReason: "source_unavailable" | "standard_unavailable",
): {
    outcome: "completed" | "failed";
    reason?: "attempt_failed" | "semantic_none" | "source_unavailable" | "standard_unavailable";
    documentCount?: number;
} {
    if (!isSuccessfulMemoryResult(result)) {
        return { outcome: "failed", reason: "attempt_failed" };
    }
    if (result.content.memoryEvidenceState === "unavailable") {
        return { outcome: "failed", reason: unavailableReason };
    }
    return {
        outcome: "completed",
        ...completedMemoryDocumentDiagnostic(result.content),
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

function stripRecoverySeed(
    result: ChatToolResult<unknown>,
    recoveryReason?: MemorySearchResult["recoveryReason"],
): ChatToolResult<unknown> {
    if (!isSuccessfulMemoryResult(result)) return result;
    return {
        ...result,
        content: {
            ...stripMemoryRecoveryState(result.content),
            ...(recoveryReason ? { recoveryReason } : {}),
        },
    };
}

function stripMemoryRecoveryState(result: MemorySearchResult): MemorySearchResult {
    const stripped = { ...result };
    delete stripped.recoverySeed;
    return stripped;
}

function interleave<T>(left: readonly T[], right: readonly T[]): T[] {
    const output: T[] = [];
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        if (left[index] !== undefined) output.push(left[index]);
        if (right[index] !== undefined) output.push(right[index]);
    }
    return output;
}

function dedupeCandidatesPreferRelaxed(
    ordered: readonly MemoryCandidate[],
    relaxed: readonly MemoryCandidate[],
): MemoryCandidate[] {
    const relaxedByPath = new Map<string, MemoryCandidate>();
    for (const candidate of relaxed) {
        const path = canonicalMemoryPath(candidate.path);
        if (path) relaxedByPath.set(path, candidate);
    }
    const output: MemoryCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of ordered) {
        const path = canonicalMemoryPath(candidate.path);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        output.push(relaxedByPath.get(path) ?? candidate);
    }
    return output;
}

function mergeCurrentMemorySourceRecords(
    standard: readonly SourceRecord[],
    relaxed: readonly SourceRecord[],
    documents: readonly MemorySearchDocument[],
): SourceRecord[] {
    const allowed = new Set(documents.map((document) => documentKey(
        document.source.path,
        document.source.chunkIndex,
    )));
    const allowedPaths = new Set(documents.map((document) => canonicalMemoryPath(document.source.path)).filter(Boolean));
    const output: SourceRecord[] = [];
    const seen = new Set<string>();
    for (const record of [...standard, ...relaxed]) {
        const path = canonicalMemoryPath(record.path ?? "");
        if (!path) continue;
        const key = documentKey(path, record.chunkIndex);
        if (!allowed.has(key) && !(record.chunkIndex === undefined && allowedPaths.has(path))) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({ ...record, path });
    }
    return output;
}

function documentKey(path: string, chunkIndex: number | undefined): string {
    return `${canonicalMemoryPath(path) ?? path}#${chunkIndex ?? ""}`;
}

function canonicalMemoryPath(path: string): string | null {
    const normalized = normalizeVaultPath(path);
    if (
        !normalized
        || !normalized.toLowerCase().endsWith(".md")
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || normalized.split("/").some((segment) => !segment || segment === "..")
    ) return null;
    return normalized;
}

function normalizePositiveMs(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}
