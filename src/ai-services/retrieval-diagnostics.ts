/* Copyright 2023 edonyzpc */

/**
 * Content-free, explicitly activated diagnostics for B-125 device calibration.
 *
 * This is deliberately an in-memory, capacity-bounded recorder. It has no
 * listener and allocates no event objects until a local measurement session is
 * started from the test harness. Event keys are allow-listed here so a caller
 * cannot accidentally place a query, path, title, excerpt, embedding, or opaque
 * graph identity in a device receipt.
 */

export const RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
const MAX_RETRIEVAL_DIAGNOSTIC_EVENTS = 512;

export type RetrievalDiagnosticSurface = "chat" | "pagelet";

export type RetrievalDiagnosticPhase =
    | "memory_search"
    | "graph_snapshot"
    | "graph_preflight"
    | "ppr_solve"
    | "graph_workset"
    | "graph_worker"
    | "reranker"
    | "recovery_standard"
    | "recovery_relaxed"
    | "recovery_projection"
    | "finalization_reserve";

export type RetrievalDiagnosticOutcome =
    | "started"
    | "completed"
    | "skipped"
    | "fallback"
    | "aborted"
    | "deadline"
    | "failed"
    | "late_discarded";

export type RetrievalDiagnosticMetricName =
    | "durationMs"
    | "remainingMs"
    | "seedCount"
    | "nodeCount"
    | "edgeCount"
    | "snapshotBytes"
    | "opaqueBridgeCount"
    | "liftedStateCount"
    | "transitionCount"
    | "projectedOperations"
    | "projectedBytes"
    | "iterationCount"
    | "errorBound"
    | "localCount"
    | "deepCount"
    | "convergenceCount"
    | "unionCount"
    | "cosinePassCount"
    | "selectedCount"
    | "candidateCount"
    | "documentCount"
    | "batchCount"
    | "chunkCount"
    | "queueWaitMs"
    | "workerDurationMs"
    | "maxBatchDurationMs"
    | "cancelRequested"
    | "cancelObserved"
    | "acceptedCount"
    | "lateDiscardCount"
    | "providerCallCount"
    | "retryConsumed"
    | "temporalFilterApplied"
    | "temporalViolationCount";

export interface RetrievalDiagnosticEventInput {
    /** Opaque agent-run identity; never a query, path, title, or source id. */
    runId?: string;
    phase: RetrievalDiagnosticPhase;
    outcome: RetrievalDiagnosticOutcome;
    /** A content-free machine reason code. Arbitrary error messages are rejected. */
    reason?: string;
    metrics?: Partial<Record<RetrievalDiagnosticMetricName, number>>;
}

export type RetrievalDiagnosticRecorder = (event: RetrievalDiagnosticEventInput) => void;

export interface RetrievalDiagnosticEvent {
    sequence: number;
    elapsedMs: number;
    surface: RetrievalDiagnosticSurface;
    runId?: string;
    phase: RetrievalDiagnosticPhase;
    outcome: RetrievalDiagnosticOutcome;
    reason?: string;
    metrics: Partial<Record<RetrievalDiagnosticMetricName, number>>;
}

export interface RetrievalDiagnosticsSessionIdentity {
    schemaVersion: typeof RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION;
    sessionId: string;
    startedAt: string;
    capacity: number;
}

export interface RetrievalDiagnosticsSnapshot extends RetrievalDiagnosticsSessionIdentity {
    finishedAt: string | null;
    droppedEventCount: number;
    events: RetrievalDiagnosticEvent[];
}

export interface RetrievalCancellationProbeAck {
    sessionId: string;
    armed: true;
}

export interface RetrievalDiagnosticsSurfaceBinding {
    record(
        requestedSurface: RetrievalDiagnosticSurface,
        input: RetrievalDiagnosticEventInput,
    ): void;
    createRecorder(
        requestedSurface: RetrievalDiagnosticSurface,
    ): RetrievalDiagnosticRecorder | undefined;
    scheduleArmedGraphWorkerCancellation(
        requestedSurface: RetrievalDiagnosticSurface,
        cancel: () => void,
    ): boolean;
}

interface ActiveRetrievalDiagnosticsSession extends RetrievalDiagnosticsSessionIdentity {
    monotonicStartedAt: number;
    sequence: number;
    droppedEventCount: number;
    events: RetrievalDiagnosticEvent[];
    cancellationProbeState: "idle" | "armed" | "consumed";
}

const PHASES = new Set<RetrievalDiagnosticPhase>([
    "memory_search",
    "graph_snapshot",
    "graph_preflight",
    "ppr_solve",
    "graph_workset",
    "graph_worker",
    "reranker",
    "recovery_standard",
    "recovery_relaxed",
    "recovery_projection",
    "finalization_reserve",
]);

const OUTCOMES = new Set<RetrievalDiagnosticOutcome>([
    "started",
    "completed",
    "skipped",
    "fallback",
    "aborted",
    "deadline",
    "failed",
    "late_discarded",
]);

const METRICS = new Set<RetrievalDiagnosticMetricName>([
    "durationMs",
    "remainingMs",
    "seedCount",
    "nodeCount",
    "edgeCount",
    "snapshotBytes",
    "opaqueBridgeCount",
    "liftedStateCount",
    "transitionCount",
    "projectedOperations",
    "projectedBytes",
    "iterationCount",
    "errorBound",
    "localCount",
    "deepCount",
    "convergenceCount",
    "unionCount",
    "cosinePassCount",
    "selectedCount",
    "candidateCount",
    "documentCount",
    "batchCount",
    "chunkCount",
    "queueWaitMs",
    "workerDurationMs",
    "maxBatchDurationMs",
    "cancelRequested",
    "cancelObserved",
    "acceptedCount",
    "lateDiscardCount",
    "providerCallCount",
    "retryConsumed",
    "temporalFilterApplied",
    "temporalViolationCount",
]);

const REASONS = new Set([
    "aborted",
    "activation_not_met",
    "attempt_aborted",
    "attempt_deadline",
    "attempt_failed",
    "boundary_changed",
    "cancel_observed",
    "cancel_requested",
    "contradictory",
    "coordinator_closed",
    "currentness_changed",
    "deadline",
    "deadline_elapsed",
    "embedding_unavailable",
    "executor_unavailable",
    "epoch_changed",
    "filtered_no_seeds",
    "flag_changed",
    "flag_off",
    "graph-rank-aborted",
    "graph-rank-budget-exceeded",
    "graph-rank-deadline",
    "graph-rank-embedding-invalid",
    "graph-rank-epoch-mismatch",
    "graph-rank-path-evidence-unavailable",
    "graph-rank-path-mismatch",
    "graph-rank-result-invalid",
    "graph-rank-source-changed",
    "graph-rank-source-epoch-mismatch",
    "graph-rank-unavailable",
    "graph-rank-worker-error",
    "graph_budget",
    "hard_deadline",
    "invalid_graph",
    "invalid_index",
    "invalid_snapshot",
    "iteration_cap",
    "late_result",
    "lead_not_requested",
    "concrete_lead_unavailable",
    "local_budget",
    "malformed",
    "model_unavailable",
    "no_seeds",
    "not_eligible",
    "numeric_error",
    "parent_aborted",
    "policy_disabled",
    "preflight_unavailable",
    "projection_aborted",
    "projection_failed",
    "projection_unavailable",
    "provider_error",
    "ranked_candidate_invalid",
    "ranked_path_invalid",
    "ranked_set_incomplete",
    "request_invalidated",
    "request_unavailable",
    "reserve_protected",
    "reserve_aborted",
    "reserve_exhausted",
    "reserve_failed",
    "reserve_not_entered",
    "seed_unavailable",
    "semantic_none",
    "snapshot_budget",
    "solve_unavailable",
    "source_changed",
    "source_unavailable",
    "standard_unavailable",
    "standard_sufficient",
    "partial_requires_stage",
    "stage_control_reserved",
    "stage_unavailable",
    "stage_validation_deadline",
    "stage_validation_failed",
    "timeout",
    "token_consumed",
    "unknown_error",
    "workset_budget",
    "workset_empty",
]);

export class RetrievalDiagnosticsController {
    private active: ActiveRetrievalDiagnosticsSession | null = null;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly monotonicNow: () => number = defaultMonotonicNow,
        private readonly createId: () => string = defaultSessionId,
    ) {}

    /**
     * Bind one Host capability to one product surface. A runtime asking that
     * Host for another surface fails closed instead of silently relabelling
     * its events.
     */
    bindSurface(surface: RetrievalDiagnosticSurface): RetrievalDiagnosticsSurfaceBinding {
        return {
            record: (requestedSurface, input) => {
                if (requestedSurface === surface) this.record(surface, input);
            },
            createRecorder: (requestedSurface) => (
                requestedSurface === surface
                    ? this.createRecorder(surface)
                    : undefined
            ),
            scheduleArmedGraphWorkerCancellation: (requestedSurface, cancel) => (
                requestedSurface === surface
                    ? this.scheduleArmedGraphWorkerCancellation(surface, cancel)
                    : false
            ),
        };
    }

    start(): RetrievalDiagnosticsSessionIdentity {
        if (this.active) throw new Error("A retrieval diagnostics session is already active.");
        const identity: RetrievalDiagnosticsSessionIdentity = {
            schemaVersion: RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION,
            sessionId: this.createId(),
            startedAt: new Date(this.now()).toISOString(),
            capacity: MAX_RETRIEVAL_DIAGNOSTIC_EVENTS,
        };
        this.active = {
            ...identity,
            monotonicStartedAt: this.monotonicNow(),
            sequence: 0,
            droppedEventCount: 0,
            events: [],
            cancellationProbeState: "idle",
        };
        return freezeClone(identity);
    }

    /** Arm one content-free, Chat-only cancellation of the next dispatched graph Worker. */
    armCancellationProbe(sessionId: string): RetrievalCancellationProbeAck {
        const active = this.requireActive(sessionId);
        if (active.cancellationProbeState !== "idle") {
            throw new Error("Retrieval cancellation probe is already armed or consumed.");
        }
        active.cancellationProbeState = "armed";
        return freezeClone({ sessionId: active.sessionId, armed: true as const });
    }

    /**
     * Consume the arm only after the index reports a real Worker dispatch. The
     * two-step microtask handoff lets the index's async send continuation post
     * its request first, while the captured active-session identity makes
     * stop/clear/restart fail closed.
     */
    scheduleArmedGraphWorkerCancellation(
        surface: RetrievalDiagnosticSurface,
        cancel: () => void,
    ): boolean {
        const active = this.active;
        if (
            surface !== "chat"
            || !active
            || active.cancellationProbeState !== "armed"
            || typeof cancel !== "function"
        ) return false;
        active.cancellationProbeState = "consumed";
        Promise.resolve()
            .then(() => undefined)
            .then(() => {
                if (this.active !== active || active.cancellationProbeState !== "consumed") return;
                try {
                    cancel();
                } catch {
                    // A diagnostics-only probe must never disturb retrieval.
                }
            });
        return true;
    }

    /** Fast no-op unless a local test session is active. */
    record(surface: RetrievalDiagnosticSurface, input: RetrievalDiagnosticEventInput): void {
        const active = this.active;
        if (!active) return;
        this.recordFor(active, surface, input);
    }

    /**
     * Capture the currently active session. Results arriving after stop(), or
     * after another session has started, are therefore discarded instead of
     * contaminating the later receipt.
     */
    createRecorder(surface: RetrievalDiagnosticSurface): RetrievalDiagnosticRecorder | undefined {
        const active = this.active;
        if (!active) return undefined;
        return (input) => {
            if (this.active !== active) return;
            this.recordFor(active, surface, input);
        };
    }

    private recordFor(
        active: ActiveRetrievalDiagnosticsSession,
        surface: RetrievalDiagnosticSurface,
        input: RetrievalDiagnosticEventInput,
    ): void {
        let normalized: ReturnType<typeof normalizeEvent>;
        try {
            normalized = normalizeEvent(input);
        } catch {
            // Diagnostics must never disturb retrieval, including hostile
            // objects with throwing getters supplied through a test seam.
            return;
        }
        if (!normalized) return;
        const event: RetrievalDiagnosticEvent = {
            sequence: ++active.sequence,
            elapsedMs: finiteNonNegative(this.monotonicNow() - active.monotonicStartedAt),
            surface,
            ...normalized,
        };
        if (active.events.length >= active.capacity) {
            active.events.shift();
            active.droppedEventCount += 1;
        }
        active.events.push(event);
    }

    snapshot(sessionId: string): RetrievalDiagnosticsSnapshot {
        const active = this.requireActive(sessionId);
        return freezeClone({
            schemaVersion: active.schemaVersion,
            sessionId: active.sessionId,
            startedAt: active.startedAt,
            finishedAt: null,
            capacity: active.capacity,
            droppedEventCount: active.droppedEventCount,
            events: active.events,
        });
    }

    stop(sessionId: string): RetrievalDiagnosticsSnapshot {
        const active = this.requireActive(sessionId);
        const result = freezeClone({
            schemaVersion: active.schemaVersion,
            sessionId: active.sessionId,
            startedAt: active.startedAt,
            finishedAt: new Date(this.now()).toISOString(),
            capacity: active.capacity,
            droppedEventCount: active.droppedEventCount,
            events: active.events,
        });
        this.active = null;
        return result;
    }

    clear(): void {
        this.active = null;
    }

    private requireActive(sessionId: string): ActiveRetrievalDiagnosticsSession {
        if (!this.active || !sessionId || this.active.sessionId !== sessionId) {
            throw new Error("Retrieval diagnostics session is unavailable or stale.");
        }
        return this.active;
    }
}

function normalizeEvent(
    input: RetrievalDiagnosticEventInput,
): Omit<RetrievalDiagnosticEvent, "sequence" | "elapsedMs" | "surface"> | null {
    if (!PHASES.has(input.phase) || !OUTCOMES.has(input.outcome)) return null;
    const runId = typeof input.runId === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.runId)
        ? input.runId
        : undefined;
    const reason = typeof input.reason === "string" && REASONS.has(input.reason)
        ? input.reason
        : undefined;
    const metrics: Partial<Record<RetrievalDiagnosticMetricName, number>> = {};
    if (input.metrics && typeof input.metrics === "object") {
        for (const [rawKey, rawValue] of Object.entries(input.metrics)) {
            const key = rawKey as RetrievalDiagnosticMetricName;
            if (!METRICS.has(key) || typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
            metrics[key] = finiteNonNegative(rawValue);
        }
    }
    return {
        ...(runId ? { runId } : {}),
        phase: input.phase,
        outcome: input.outcome,
        ...(reason ? { reason } : {}),
        metrics,
    };
}

function finiteNonNegative(value: number): number {
    return Number(Math.max(0, value).toFixed(6));
}

function defaultMonotonicNow(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function defaultSessionId(): string {
    const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `retrieval-diagnostics-${random}`;
}

function freezeClone<T>(value: T): T {
    return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return Object.freeze(value);
}
