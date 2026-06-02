/**
 * Runtime integration glue — framework SDD §3 + §5.3 + §6.
 *
 * Two responsibilities:
 *
 *   1. **Self-Write Set** (`createSelfWriteRegistry`): TTL-bounded record of
 *      paths the framework has just written, so a caller's `vault.on("modify")`
 *      listener can skip its own ripple. v1 window = 5s per SDD §5.3.
 *      Belt-and-suspenders for D029 R3 assumption (vault.adapter.write may bypass
 *      modify event); if that assumption is ever broken upstream, this Set
 *      prevents a self-summoning loop.
 *
 *   2. **ActionExecutor** (`createActionExecutor`): 4-gate orchestrator that
 *      sequences a {@link WriteActionCapability} through target-confinement →
 *      preview-confirmation → stale-reread → executeWrite, emitting the
 *      structured debug events at each transition. Rollback is invoked on
 *      execute failure when the capability declares one.
 *
 * The executor is pure-ish: it depends on three injected services
 * (PreviewRenderer, fsProbe, DebugObserver) plus a run-id factory. Nothing is
 * module-scope, so multiple PA runtimes can co-exist (test isolation).
 */

import type {
    AgentCapabilityContext,
    AgentCapabilityResult,
} from "../capability-types";
import {
    NOOP_DEBUG_OBSERVER,
} from "./debug-observer";
import type { PreviewRenderer } from "./preview-modal";
import {
    checkStaleReread,
    takeSnapshot,
    type StaleReadProbe,
} from "./stale-reread";
import {
    validateTargetConfinement,
    type ConfinementFsProbe,
} from "./target-confinement";
import type {
    DebugEvent,
    DebugEventType,
    DebugObserver,
    PreviewSpec,
    WriteActionCapability,
    WriteActionExecuteHooks,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Self-Write Set
// ─────────────────────────────────────────────────────────────────────────────

/** Default window during which a path is considered "recently self-written". */
export const SELF_WRITE_WINDOW_MS = 5_000;

export interface SelfWriteRegistry {
    markSelfWrite(path: string): void;
    isRecentSelfWrite(path: string): boolean;
    /**
     * Clear all entries + cancel pending TTL timers. MUST be called on plugin
     * unload so dangling setTimeouts don't keep the runtime alive.
     */
    dispose(): void;
    /** Currently-known paths (for diagnostics / tests). */
    snapshot(): string[];
}

export interface SelfWriteRegistryOptions {
    windowMs?: number;
    /** Test seam: override Date.now / setTimeout / clearTimeout. */
    now?: () => number;
    setTimer?: (cb: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export function createSelfWriteRegistry(options: SelfWriteRegistryOptions = {}): SelfWriteRegistry {
    const windowMs = options.windowMs ?? SELF_WRITE_WINDOW_MS;
    const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const paths = new Set<string>();
    const timers = new Map<string, unknown>();

    return {
        markSelfWrite(path: string): void {
            // Re-mark refreshes the TTL: cancel old timer, schedule a new one.
            const existing = timers.get(path);
            if (existing !== undefined) clearTimer(existing);
            paths.add(path);
            const handle = setTimer(() => {
                paths.delete(path);
                timers.delete(path);
            }, windowMs);
            timers.set(path, handle);
        },
        isRecentSelfWrite(path: string): boolean {
            return paths.has(path);
        },
        dispose(): void {
            for (const handle of timers.values()) {
                clearTimer(handle);
            }
            timers.clear();
            paths.clear();
        },
        snapshot(): string[] {
            return Array.from(paths);
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionExecutor — 4-gate orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/** Joint FS adapter shape used by Gate 1 + Gate 3. Mirrors `vault.adapter.exists`. */
export type FsProbe = ConfinementFsProbe & StaleReadProbe;

export interface ActionExecutor {
    /**
     * Drive a single WriteActionCapability through all 4 gates. Returns the
     * capability's AgentCapabilityResult on success, or a synthesized failure
     * result when a gate rejects / the user declines.
     */
    execute(
        capability: WriteActionCapability,
        input: unknown,
        context: AgentCapabilityContext,
    ): Promise<AgentCapabilityResult>;
}

export interface ActionExecutorOptions {
    previewRenderer: PreviewRenderer;
    /**
     * Filesystem probe used by Gate 1 (collision/folder) + Gate 3 (snapshot).
     * If omitted, both gates skip their async FS sub-checks (sync confinement
     * still runs). The Pagelet runtime should pass `app.vault.adapter`.
     */
    fsProbe?: FsProbe;
    selfWrite?: SelfWriteRegistry;
    debugObserver?: DebugObserver;
    /** Test seam for deterministic ids. */
    runIdFactory?: () => string;
    /** Test seam for elapsed-time measurement. */
    now?: () => number;
}

export function createActionExecutor(options: ActionExecutorOptions): ActionExecutor {
    const previewRenderer = options.previewRenderer;
    const fsProbe = options.fsProbe;
    const selfWrite = options.selfWrite ?? createSelfWriteRegistry();
    const debugObserver = options.debugObserver ?? NOOP_DEBUG_OBSERVER;
    const now = options.now ?? Date.now;
    const runIdFactory =
        options.runIdFactory ??
        (() => `run-${now()}-${Math.random().toString(36).slice(2, 8)}`);

    function emit(
        type: DebugEventType,
        capability: WriteActionCapability,
        runId: string,
        turnId: string,
        extras: Partial<DebugEvent> = {},
    ): void {
        const event: DebugEvent = {
            type,
            capabilityId: capability.name,
            runId,
            turnId,
            ...extras,
        };
        try {
            debugObserver.emit(event);
        } catch {
            // Best-effort: never let observer faults break the action lifecycle.
        }
    }

    function failure(
        capability: WriteActionCapability,
        reason: string,
        userSafeMessage?: string,
    ): AgentCapabilityResult {
        return {
            status: "failed",
            observation: null,
            sourceRecords: [],
            inputSummary: capability.name,
            sources: [],
            error: reason,
            userSafeMessage,
        };
    }

    return {
        async execute(capability, input, context): Promise<AgentCapabilityResult> {
            const runId = runIdFactory();
            const turnId = context.turnId ?? "unknown";
            const startedAt = now();

            // ────────────────────────────────────────────────────────────────
            // Gate 0: build preview first (pure per Step 0 contract). This gives
            // us the target.path string used by Gate 1, without forcing
            // capabilities to expose a separate getTargetPath() method.
            // ────────────────────────────────────────────────────────────────
            let spec: PreviewSpec;
            try {
                spec = await capability.buildPreview(input, context);
            } catch (error) {
                emit("execute.fail", capability, runId, turnId, {
                    errorCategory: "unknown",
                    extra: {
                        stage: "buildPreview",
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
                return failure(
                    capability,
                    `buildPreview threw: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            // ────────────────────────────────────────────────────────────────
            // Gate 1: target confinement
            // ────────────────────────────────────────────────────────────────
            const confinement = await validateTargetConfinement(
                spec.target.path,
                capability.targetConfinement,
                fsProbe,
            );
            if (!confinement.ok) {
                emit("gate.target-confinement.reject", capability, runId, turnId, {
                    errorCategory: "rejected_at_confinement",
                    extra: {
                        reason: confinement.reason,
                        detail: confinement.detail,
                        candidatePath: spec.target.path,
                        targetCategory: capability.targetCategory,
                    },
                });
                return failure(
                    capability,
                    `target rejected at confinement: ${confinement.reason}`,
                    "The proposed file path was rejected by safety checks.",
                );
            }
            emit("gate.target-confinement.ok", capability, runId, turnId, {
                extra: {
                    normalizedPath: confinement.normalizedPath,
                    targetCategory: capability.targetCategory,
                },
            });

            // ────────────────────────────────────────────────────────────────
            // Gate 2: preview-confirmation lifecycle
            // (snapshot for Gate 3 captured at preview time per SDD §2.3)
            // ────────────────────────────────────────────────────────────────
            const snapshot = fsProbe
                ? await takeSnapshot(confinement.normalizedPath, fsProbe, now)
                : {
                    targetPath: confinement.normalizedPath,
                    folderExists: true,
                    targetExists: false,
                    capturedAt: now(),
                };
            emit("gate.preview.shown", capability, runId, turnId, {
                extra: {
                    targetCategory: capability.targetCategory,
                    normalizedPath: confinement.normalizedPath,
                    snapshotAt: snapshot.capturedAt,
                },
            });
            const { outcome, renderWarnings } = await previewRenderer.show(spec, {
                signal: context.signal,
            });
            emit("gate.confirmation.received", capability, runId, turnId, {
                extra: {
                    outcome,
                    renderWarnings,
                    targetCategory: capability.targetCategory,
                },
            });
            if (outcome !== "confirmed") {
                return failure(
                    capability,
                    `user did not confirm: ${outcome}`,
                    outcome === "aborted" ? "Action was aborted." : undefined,
                );
            }

            // ────────────────────────────────────────────────────────────────
            // Gate 3: stale re-read (mode A)
            // ────────────────────────────────────────────────────────────────
            if (fsProbe) {
                const stale = await checkStaleReread(snapshot, fsProbe, now);
                if (stale.stale) {
                    emit("gate.stale-reread.drift", capability, runId, turnId, {
                        errorCategory: "stale_drift",
                        extra: {
                            drift: stale.drift,
                            targetCategory: capability.targetCategory,
                            normalizedPath: confinement.normalizedPath,
                            snapshotAt: snapshot.capturedAt,
                            checkedAt: stale.checkedAt,
                        },
                    });
                    return failure(
                        capability,
                        "target snapshot drift detected before execute",
                        "The file state changed while the preview was shown; the action was cancelled.",
                    );
                }
                emit("gate.stale-reread.ok", capability, runId, turnId, {
                    extra: {
                        normalizedPath: confinement.normalizedPath,
                        targetCategory: capability.targetCategory,
                    },
                });
            } else {
                // No probe → Gate 3 short-circuits as a successful check.
                emit("gate.stale-reread.ok", capability, runId, turnId, {
                    extra: {
                        skipped: true,
                        targetCategory: capability.targetCategory,
                    },
                });
            }

            // ────────────────────────────────────────────────────────────────
            // Execute: real write happens inside capability.executeWrite.
            // Framework marks self-write BEFORE delegating so the caller's
            // modify listener (if any) sees the entry by the time the write
            // event ripples back.
            // ────────────────────────────────────────────────────────────────
            const hooks: WriteActionExecuteHooks = {
                markSelfWrite: (path: string) => selfWrite.markSelfWrite(path),
            };
            // Mark the framework-validated target proactively (capability may
            // also mark additional paths if it writes auxiliary files).
            selfWrite.markSelfWrite(confinement.normalizedPath);

            let result: AgentCapabilityResult;
            const execStartedAt = now();
            try {
                result = await capability.executeWrite(input, context, hooks);
            } catch (error) {
                const durationMs = now() - execStartedAt;
                const message = error instanceof Error ? error.message : String(error);
                emit("execute.fail", capability, runId, turnId, {
                    durationMs,
                    errorCategory: "fs_error",
                    extra: {
                        stage: "executeWrite",
                        message,
                        targetCategory: capability.targetCategory,
                        normalizedPath: confinement.normalizedPath,
                    },
                });
                await runRollback(capability, input, context, runId, turnId);
                return failure(
                    capability,
                    `executeWrite threw: ${message}`,
                    "The write failed and any partial output was rolled back.",
                );
            }

            const durationMs = now() - execStartedAt;
            if (result.status === "ok") {
                emit("execute.ok", capability, runId, turnId, {
                    durationMs,
                    extra: {
                        targetCategory: capability.targetCategory,
                        normalizedPath: confinement.normalizedPath,
                        totalDurationMs: now() - startedAt,
                    },
                });
                return result;
            }

            // capability returned non-ok status without throwing — emit fail
            // but don't auto-rollback (capability may have already cleaned up).
            emit("execute.fail", capability, runId, turnId, {
                durationMs,
                errorCategory: result.status === "unavailable" ? "policy_violation" : "unknown",
                extra: {
                    stage: "executeWrite",
                    capabilityStatus: result.status,
                    capabilityError: result.error,
                    targetCategory: capability.targetCategory,
                    normalizedPath: confinement.normalizedPath,
                },
            });
            await runRollback(capability, input, context, runId, turnId);
            return result;

            async function runRollback(
                cap: WriteActionCapability,
                rawInput: unknown,
                ctx: AgentCapabilityContext,
                rid: string,
                tid: string,
            ): Promise<void> {
                if (!cap.rollback) return;
                const rollbackStart = now();
                try {
                    await cap.rollback(rawInput, ctx);
                    emit("rollback.ok", cap, rid, tid, {
                        durationMs: now() - rollbackStart,
                        extra: { targetCategory: cap.targetCategory },
                    });
                } catch (error) {
                    emit("rollback.fail", cap, rid, tid, {
                        durationMs: now() - rollbackStart,
                        errorCategory: "fs_error",
                        extra: {
                            cascade: true,
                            message: error instanceof Error ? error.message : String(error),
                            targetCategory: cap.targetCategory,
                        },
                    });
                }
            }
        },
    };
}
