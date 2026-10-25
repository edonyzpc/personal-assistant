/**
 * Debug Observability Hook — framework SDD §2.4.
 *
 * **Not** a production audit store. v1 only emits structured events to a configured
 * DebugObserver for developer triage; nothing is persisted to disk, no retention
 * policy, no opt-in tier. Two built-in implementations:
 *
 *   - {@link NoopDebugObserver}  — production default; zero-overhead no-op.
 *   - {@link ConsoleDebugObserver} — development default; routes to console.debug
 *     with a stable `[write-action-framework]` prefix for grep-ability.
 *
 * Future Operations Agent mode (v2+) may inject a `PersistentAuditObserver`
 * implementing the same `DebugObserver` interface without changing framework
 * internals (framework SDD §10 upgrade trigger).
 */

import type { DebugEvent, DebugObserver } from "./types";

/** Production default. Discards every event. Constant-time, allocation-free. */
export class NoopDebugObserver implements DebugObserver {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- The interface requires the event parameter, but this sink intentionally discards it.
    emit(_event: DebugEvent): void {
        /* intentionally empty */
    }
}

/** Shared singleton instance for the common case (avoid per-runtime allocation). */
export const NOOP_DEBUG_OBSERVER: DebugObserver = new NoopDebugObserver();

/**
 * Routes events to `console.debug` (or a caller-supplied logger for test
 * isolation). Each event is logged as a single call so devtools can collapse
 * by group: `[write-action-framework] {type} {capabilityId}` + raw event object.
 */
export class ConsoleDebugObserver implements DebugObserver {
    constructor(
        private readonly logger: (...args: unknown[]) => void = (...args) => {
            const consoleLogger = console;
            if (typeof consoleLogger?.debug === "function") {
                consoleLogger.debug(...args);
            }
        },
        private readonly prefix: string = "[write-action-framework]",
    ) {}

    emit(event: DebugEvent): void {
        // Single-call format keeps grep/devtools collapsing predictable.
        this.logger(`${this.prefix} ${event.type} ${event.capabilityId}`, event);
    }
}
