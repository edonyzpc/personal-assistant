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
    ConfinementConfigError,
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
import { clearPlatformTimeout, setPlatformTimeout } from "../../platform-dom";

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
    const setTimer = options.setTimer ?? ((cb, ms) => setPlatformTimeout(cb, ms));
    const clearTimer = options.clearTimer ?? ((h) => clearPlatformTimeout(h as ReturnType<typeof setTimeout>));
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

/**
 * Optional `remove` probe used by the framework's create-file rollback safety
 * net (Fix #4 / SDD §3.3 line 466). Tests usually omit it; production wires
 * `app.vault.adapter.remove` which already satisfies this signature.
 */
export interface FsRemoveProbe {
    remove(path: string): Promise<void>;
}

/**
 * Joint FS adapter shape used by Gate 1 + Gate 3 + create-file auto-rollback.
 * Mirrors `vault.adapter.{exists,remove}`. `remove` is optional so the
 * framework degrades gracefully (capability-only rollback) when callers do
 * not supply it.
 */
export type FsProbe = ConfinementFsProbe & StaleReadProbe & Partial<FsRemoveProbe>;

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

    function describeError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    function shouldSkipWriteRollback(error: unknown): boolean {
        return Boolean(
            error
            && typeof error === "object"
            && (error as { skipWriteRollback?: unknown }).skipWriteRollback === true,
        );
    }

    return {
        async execute(capability, input, context): Promise<AgentCapabilityResult> {
            const runId = runIdFactory();
            const turnId = context.turnId ?? "unknown";
            const startedAt = now();

            // ────────────────────────────────────────────────────────────────
            // Gate 1 — Target Confinement (Fix #3: runs BEFORE buildPreview)
            //
            // We obtain the candidate path from a NEW synchronous + pure
            // `getTargetPath(input)` API. This ensures untrusted LLM input is
            // validated against the per-capability allowlist BEFORE any
            // side-effect-capable code (`buildPreview`) consumes it. The
            // displayPath in the eventual PreviewSpec is cross-checked
            // against the path validated here.
            // ────────────────────────────────────────────────────────────────
            let candidatePath: string;
            try {
                candidatePath = capability.getTargetPath(input);
            } catch (error) {
                emit("gate.target-confinement.reject", capability, runId, turnId, {
                    errorCategory: "user_aborted",
                    extra: {
                        stage: "getTargetPath",
                        message: describeError(error),
                        targetCategory: capability.targetCategory,
                    },
                });
                return failure(
                    capability,
                    `getTargetPath threw: ${describeError(error)}`,
                    "The proposed file path was rejected by safety checks.",
                );
            }

            let confinement: Awaited<ReturnType<typeof validateTargetConfinement>>;
            try {
                confinement = await validateTargetConfinement(
                    candidatePath,
                    capability.targetConfinement,
                    fsProbe,
                );
            } catch (error) {
                // Issue #358 AC #1: a ConfinementConfigError from
                // `validateAllowedRoots`. **This branch is load-bearing —
                // do not remove**, even though `validateTargetConfinement`
                // itself never throws this type. The error originates from
                // the `capability.targetConfinement` property access on the
                // line above: Pagelet exposes `targetConfinement` as a getter
                // (`pa-review-tool-provider.ts:410`) that rebuilds on every
                // read, so `buildConfinement` → `validateAllowedRoots`
                // executes inside this try block and any throw is caught
                // here. Without this branch the throw would surface under
                // `errorCategory: "fs_error"` (the generic catch below),
                // which is semantically wrong — a config rejection is not
                // a filesystem error. Re-emit on `rejected_at_confinement`
                // so triage sees one event shape for both rejection paths
                // (construction-side AND candidate-side).
                if (error instanceof ConfinementConfigError) {
                    emit("gate.target-confinement.reject", capability, runId, turnId, {
                        errorCategory: "rejected_at_confinement",
                        extra: {
                            reason: error.reason,
                            detail: `allowedRoots entry "${error.offendingRoot}" rejected at construction (segment "${error.offendingSegment}")`,
                            candidatePath,
                            targetCategory: capability.targetCategory,
                        },
                    });
                    return failure(
                        capability,
                        `target rejected at confinement: ${error.reason}`,
                        "The proposed file path was rejected by safety checks.",
                    );
                }
                emit("gate.target-confinement.reject", capability, runId, turnId, {
                    errorCategory: "fs_error",
                    extra: {
                        stage: "validateTargetConfinement",
                        message: describeError(error),
                        candidatePath,
                        targetCategory: capability.targetCategory,
                    },
                });
                return failure(
                    capability,
                    `target confinement check failed: ${describeError(error)}`,
                    "The proposed file path could not be validated.",
                );
            }
            if (!confinement.ok) {
                emit("gate.target-confinement.reject", capability, runId, turnId, {
                    errorCategory: "rejected_at_confinement",
                    extra: {
                        reason: confinement.reason,
                        detail: confinement.detail,
                        candidatePath,
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
            // Gate 2 — Preview-Confirmation Lifecycle
            //
            // buildPreview runs ONLY after the path passed confinement (Fix #3).
            // The returned spec.target.displayPath must match the confined
            // path — mismatch is treated as a confinement rejection so a
            // sneaky capability cannot show a preview for path A and then
            // write path B.
            // ────────────────────────────────────────────────────────────────
            let spec: PreviewSpec;
            try {
                spec = await capability.buildPreview(input, context);
            } catch (error) {
                emit("execute.fail", capability, runId, turnId, {
                    errorCategory: "user_aborted",
                    extra: {
                        stage: "buildPreview",
                        message: describeError(error),
                        targetCategory: capability.targetCategory,
                    },
                });
                return failure(
                    capability,
                    `buildPreview threw: ${describeError(error)}`,
                );
            }
            if (spec.target.displayPath !== confinement.normalizedPath) {
                emit("gate.target-confinement.reject", capability, runId, turnId, {
                    errorCategory: "rejected_at_confinement",
                    extra: {
                        reason: "path mismatch between getTargetPath and buildPreview",
                        getTargetPath: confinement.normalizedPath,
                        previewDisplayPath: spec.target.displayPath,
                        targetCategory: capability.targetCategory,
                    },
                });
                return failure(
                    capability,
                    "spec.target.displayPath does not match the confined path",
                    "The proposed file path was rejected by safety checks.",
                );
            }

            // Snapshot for Gate 3 captured at preview time per SDD §2.3.
            // `takeSnapshot` only runs when fsProbe is supplied; wrap in
            // try/catch (Fix #5) so a probe fault never escapes as an
            // unhandled rejection.
            let snapshot: ReturnType<typeof buildEmptySnapshot>;
            if (fsProbe) {
                try {
                    snapshot = await takeSnapshot(confinement.normalizedPath, fsProbe, now);
                } catch (error) {
                    emit("gate.target-confinement.reject", capability, runId, turnId, {
                        errorCategory: "fs_error",
                        extra: {
                            stage: "takeSnapshot",
                            message: describeError(error),
                            normalizedPath: confinement.normalizedPath,
                            targetCategory: capability.targetCategory,
                        },
                    });
                    return failure(
                        capability,
                        `takeSnapshot failed: ${describeError(error)}`,
                        "The file state could not be sampled before preview.",
                    );
                }
            } else {
                snapshot = buildEmptySnapshot(confinement.normalizedPath, now());
            }
            emit("gate.preview.shown", capability, runId, turnId, {
                extra: {
                    targetCategory: capability.targetCategory,
                    normalizedPath: confinement.normalizedPath,
                    snapshotAt: snapshot.capturedAt,
                },
            });
            let outcome: Awaited<ReturnType<typeof previewRenderer.show>>["outcome"];
            let renderWarnings: string[] | undefined;
            try {
                const showResult = await previewRenderer.show(spec, {
                    signal: context.signal,
                });
                outcome = showResult.outcome;
                renderWarnings = showResult.renderWarnings;
            } catch (error) {
                emit("gate.confirmation.received", capability, runId, turnId, {
                    errorCategory: "preview_render_failed",
                    extra: {
                        outcome: "aborted",
                        renderWarnings: [`preview renderer threw: ${describeError(error)}`],
                        targetCategory: capability.targetCategory,
                    },
                });
                return failure(
                    capability,
                    `preview render failed: ${describeError(error)}`,
                    "The preview could not be displayed; the action was cancelled.",
                );
            }
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
            // Gate 3 — Stale Re-read (mode A)
            // ────────────────────────────────────────────────────────────────
            if (fsProbe) {
                let stale: Awaited<ReturnType<typeof checkStaleReread>>;
                try {
                    stale = await checkStaleReread(snapshot, fsProbe, now);
                } catch (error) {
                    emit("gate.stale-reread.drift", capability, runId, turnId, {
                        errorCategory: "fs_error",
                        extra: {
                            stage: "checkStaleReread",
                            message: describeError(error),
                            normalizedPath: confinement.normalizedPath,
                            targetCategory: capability.targetCategory,
                            snapshotAt: snapshot.capturedAt,
                        },
                    });
                    return failure(
                        capability,
                        `stale-reread probe failed: ${describeError(error)}`,
                        "The file state could not be re-validated before write.",
                    );
                }
                if (stale.stale) {
                    emit("gate.stale-reread.drift", capability, runId, turnId, {
                        errorCategory: "stale_target",
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
            const executeAttempted = true;
            try {
                result = await capability.executeWrite(input, context, hooks);
            } catch (error) {
                const durationMs = now() - execStartedAt;
                const message = describeError(error);
                const rollbackAllowed = !shouldSkipWriteRollback(error);
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
                await runRollback(
                    capability,
                    input,
                    context,
                    runId,
                    turnId,
                    confinement.normalizedPath,
                    executeAttempted && rollbackAllowed,
                );
                return failure(
                    capability,
                    `executeWrite threw: ${message}`,
                    rollbackAllowed
                        ? "The write failed and any partial output was rolled back."
                        : "The write failed before any output was written.",
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
                // Fix #7: refresh the self-write TTL after a slow vault IO
                // path. The capability's own markSelfWrite (called inside
                // executeWrite) and our pre-execute mark may have aged past
                // the 5s window if executeWrite took a long time; this
                // belt-and-suspenders refresh keeps the modify listener
                // suppression honest on the success path.
                selfWrite.markSelfWrite(confinement.normalizedPath);
                return result;
            }

            // capability returned non-ok status without throwing — emit fail
            // with category mapped to capability status. Auto-rollback still
            // runs so create-file partial writes don't linger.
            emit("execute.fail", capability, runId, turnId, {
                durationMs,
                errorCategory:
                    result.status === "unavailable" ? "permission_denied" : "fs_error",
                extra: {
                    stage: "executeWrite",
                    capabilityStatus: result.status,
                    capabilityError: result.error,
                    targetCategory: capability.targetCategory,
                    normalizedPath: confinement.normalizedPath,
                },
            });
            await runRollback(
                capability,
                input,
                context,
                runId,
                turnId,
                confinement.normalizedPath,
                executeAttempted,
            );
            return result;

            /**
             * Run capability rollback (when declared) followed by the
             * framework's create-file safety net (Fix #4). Either step may
             * run independently:
             *
             *   - `cap.rollback` is awaited first when declared.
             *   - The framework `fsProbe.remove(target)` then runs when the
             *     family is `create-file`, a probe is wired, and executeWrite
             *     was attempted. This honors SDD §3.3 line 466: the framework
             *     auto-removes the partial file even when the capability did
             *     not implement rollback.
             *
             * Both surfaces emit a separate `rollback.ok` / `rollback.fail`
             * pair so the developer can tell which layer cleaned up.
             */
            async function runRollback(
                cap: WriteActionCapability,
                rawInput: unknown,
                ctx: AgentCapabilityContext,
                rid: string,
                tid: string,
                normalizedPath: string,
                writeAttempted: boolean,
            ): Promise<void> {
                if (cap.rollback) {
                    const rollbackStart = now();
                    try {
                        await cap.rollback(rawInput, ctx);
                        emit("rollback.ok", cap, rid, tid, {
                            durationMs: now() - rollbackStart,
                            extra: {
                                layer: "capability",
                                targetCategory: cap.targetCategory,
                            },
                        });
                    } catch (error) {
                        emit("rollback.fail", cap, rid, tid, {
                            durationMs: now() - rollbackStart,
                            errorCategory: "fs_error",
                            extra: {
                                layer: "capability",
                                cascade: true,
                                message: describeError(error),
                                targetCategory: cap.targetCategory,
                            },
                        });
                    }
                }
                // Framework safety net for create-file (SDD §3.3 line 466).
                if (
                    cap.actionFamily === "create-file"
                    && writeAttempted
                    && fsProbe?.remove
                ) {
                    const removeStart = now();
                    try {
                        await fsProbe.remove(normalizedPath);
                        emit("rollback.ok", cap, rid, tid, {
                            durationMs: now() - removeStart,
                            extra: {
                                layer: "framework",
                                cascade: Boolean(cap.rollback),
                                normalizedPath,
                                targetCategory: cap.targetCategory,
                            },
                        });
                    } catch (error) {
                        emit("rollback.fail", cap, rid, tid, {
                            durationMs: now() - removeStart,
                            errorCategory: "fs_error",
                            extra: {
                                layer: "framework",
                                cascade: Boolean(cap.rollback),
                                normalizedPath,
                                message: describeError(error),
                                targetCategory: cap.targetCategory,
                            },
                        });
                    }
                }
            }
        },
    };
}

/**
 * Build the placeholder snapshot used when no FS probe is wired. Mirrors the
 * old inline literal but extracted for typing (`takeSnapshot` returns
 * `Promise<TargetSnapshot>` which is the same shape).
 */
function buildEmptySnapshot(targetPath: string, capturedAt: number): {
    targetPath: string;
    folderExists: boolean;
    targetExists: boolean;
    capturedAt: number;
} {
    return {
        targetPath,
        folderExists: true,
        targetExists: false,
        capturedAt,
    };
}
