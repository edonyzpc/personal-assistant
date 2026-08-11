import {
    RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION,
    RetrievalDiagnosticsController,
    type RetrievalDiagnosticEventInput,
} from "../src/ai-services/retrieval-diagnostics";
import {
    resolveGraphPreflightDiagnostic,
    resolveGraphWorkerFailureOutcome,
    shouldRecordGraphWorkerFailureTerminal,
} from "../src/ai-services/memory-search-tool";

describe("RetrievalDiagnosticsController", () => {
    test("is inert until explicitly started and returns immutable snapshots", () => {
        let wall = 1_000;
        let monotonic = 10;
        const controller = new RetrievalDiagnosticsController(
            () => wall,
            () => monotonic,
            () => "session-a",
        );

        const chatBinding = controller.bindSurface("chat");
        expect(chatBinding.createRecorder("chat")).toBeUndefined();
        chatBinding.record("chat", { phase: "memory_search", outcome: "started" });
        const identity = controller.start();
        expect(identity).toEqual({
            schemaVersion: RETRIEVAL_DIAGNOSTICS_SCHEMA_VERSION,
            sessionId: "session-a",
            startedAt: new Date(1_000).toISOString(),
            capacity: 512,
        });
        expect(Object.isFrozen(identity)).toBe(true);

        monotonic = 16.25;
        controller.record("chat", {
            phase: "memory_search",
            outcome: "completed",
            reason: "graph-rank-aborted",
            metrics: {
                durationMs: 6.25,
                documentCount: 2,
                temporalFilterApplied: 1,
                temporalViolationCount: 0,
            },
        });
        const snapshot = controller.snapshot(identity.sessionId);
        expect(snapshot.events).toEqual([{
            sequence: 1,
            elapsedMs: 6.25,
            surface: "chat",
            phase: "memory_search",
            outcome: "completed",
            reason: "graph-rank-aborted",
            metrics: {
                durationMs: 6.25,
                documentCount: 2,
                temporalFilterApplied: 1,
                temporalViolationCount: 0,
            },
        }]);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.events)).toBe(true);
        expect(Object.isFrozen(snapshot.events[0].metrics)).toBe(true);

        wall = 1_100;
        const stopped = controller.stop(identity.sessionId);
        expect(stopped.finishedAt).toBe(new Date(1_100).toISOString());
        expect(() => controller.snapshot(identity.sessionId)).toThrow(/unavailable or stale/i);
    });

    test("strictly allow-lists fields and bounds the ring buffer", () => {
        let monotonic = 0;
        const controller = new RetrievalDiagnosticsController(
            () => 0,
            () => monotonic++,
            () => "session-b",
        );
        const session = controller.start();
        const unsafe = {
            phase: "graph_worker",
            outcome: "completed",
            reason: "launch",
            metrics: {
                chunkCount: 3,
                durationMs: -5,
                query: 42,
                model: 7,
                token: 9,
            },
            query: "private query",
            path: "Secret/Note.md",
            title: "Secret",
            body: "body",
            opaqueId: "opaque-node",
            model: "model-name",
            token: "api-token",
        } as unknown as RetrievalDiagnosticEventInput;
        controller.record("chat", unsafe);
        const sanitized = controller.snapshot(session.sessionId);
        expect(sanitized.events[0]).toEqual(expect.objectContaining({
            phase: "graph_worker",
            outcome: "completed",
            surface: "chat",
            metrics: { chunkCount: 3, durationMs: 0 },
        }));
        expect(sanitized.events[0].reason).toBeUndefined();
        expect(JSON.stringify(sanitized)).not.toMatch(/private|Secret|opaque-node|model-name|api-token|launch/);
        for (let index = 0; index < 512; index += 1) {
            controller.record("chat", {
                phase: "graph_worker",
                outcome: "completed",
                metrics: { batchCount: index },
            });
        }

        const snapshot = controller.snapshot(session.sessionId);
        expect(snapshot.events).toHaveLength(512);
        expect(snapshot.droppedEventCount).toBe(1);
        expect(snapshot.events[0].sequence).toBe(2);
        expect(Object.keys(snapshot.events.at(-1)!.metrics)).toEqual(["batchCount"]);
    });

    test("session-scoped recorders discard late completions after stop or restart", () => {
        let nextId = 0;
        const controller = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => `session-${++nextId}`,
        );
        const first = controller.start();
        const firstRecorder = controller.createRecorder("pagelet")!;
        firstRecorder({ phase: "graph_worker", outcome: "started" });
        controller.stop(first.sessionId);

        const second = controller.start();
        firstRecorder({ phase: "graph_worker", outcome: "late_discarded" });
        const secondRecorder = controller.createRecorder("chat")!;
        secondRecorder({ phase: "memory_search", outcome: "completed" });

        expect(controller.snapshot(second.sessionId).events).toEqual([expect.objectContaining({
            surface: "chat",
            phase: "memory_search",
            outcome: "completed",
        })]);
    });

    test("rejects malformed events without affecting retrieval callers", () => {
        const controller = new RetrievalDiagnosticsController(() => 0, () => 0, () => "session-c");
        const session = controller.start();
        const throwing = Object.defineProperty({}, "phase", {
            get: () => { throw new Error("must stay observational"); },
        }) as RetrievalDiagnosticEventInput;
        expect(() => controller.record("chat", throwing)).not.toThrow();
        expect(controller.snapshot(session.sessionId).events).toEqual([]);
    });

    test("binds surface to the recorder and ignores caller spoofing", () => {
        const controller = new RetrievalDiagnosticsController(() => 0, () => 0, () => "session-d");
        const session = controller.start();
        const pageletBinding = controller.bindSurface("pagelet");
        expect(pageletBinding.createRecorder("chat")).toBeUndefined();
        pageletBinding.record("chat", { phase: "graph_worker", outcome: "started" });
        const pageletRecorder = pageletBinding.createRecorder("pagelet")!;
        const spoofed = {
            surface: "chat",
            phase: "memory_search",
            outcome: "completed",
        } as unknown as RetrievalDiagnosticEventInput;

        pageletRecorder(spoofed);

        expect(controller.snapshot(session.sessionId).events).toEqual([
            expect.objectContaining({
                surface: "pagelet",
                phase: "memory_search",
                outcome: "completed",
            }),
        ]);
    });

    test("keeps only bounded opaque run identities", () => {
        const controller = new RetrievalDiagnosticsController(() => 0, () => 0, () => "session-run-id");
        const session = controller.start();
        controller.record("chat", {
            runId: "run_abc123_safe",
            phase: "memory_search",
            outcome: "completed",
        });
        controller.record("chat", {
            runId: "Secret/Note.md",
            phase: "memory_search",
            outcome: "completed",
        });

        expect(controller.snapshot(session.sessionId).events).toEqual([
            expect.objectContaining({ runId: "run_abc123_safe" }),
            expect.not.objectContaining({ runId: expect.anything() }),
        ]);
    });

    test("arms one Chat-only dispatched-Worker cancellation for the active session", async () => {
        let nextId = 0;
        const controller = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => `probe-session-${++nextId}`,
        );
        const cancel = jest.fn();
        const chatBinding = controller.bindSurface("chat");
        const pageletBinding = controller.bindSurface("pagelet");

        expect(() => controller.armCancellationProbe("missing")).toThrow(/unavailable or stale/i);
        const session = controller.start();
        expect(() => controller.armCancellationProbe("stale-session")).toThrow(/unavailable or stale/i);
        const ack = controller.armCancellationProbe(session.sessionId);
        expect(ack).toEqual({ sessionId: session.sessionId, armed: true });
        expect(Object.isFrozen(ack)).toBe(true);
        expect(() => controller.armCancellationProbe(session.sessionId)).toThrow(/already armed or consumed/i);

        expect(pageletBinding.scheduleArmedGraphWorkerCancellation("pagelet", cancel)).toBe(false);
        expect(chatBinding.scheduleArmedGraphWorkerCancellation("pagelet", cancel)).toBe(false);
        expect(chatBinding.scheduleArmedGraphWorkerCancellation("chat", cancel)).toBe(true);
        expect(chatBinding.scheduleArmedGraphWorkerCancellation("chat", cancel)).toBe(false);
        expect(cancel).not.toHaveBeenCalled();

        await Promise.resolve();
        expect(cancel).not.toHaveBeenCalled();
        await Promise.resolve();

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(() => controller.armCancellationProbe(session.sessionId)).toThrow(/already armed or consumed/i);
        expect(controller.snapshot(session.sessionId).events).toEqual([]);
    });

    test("clears armed and queued cancellation probes on stop or clear", async () => {
        let nextId = 0;
        const controller = new RetrievalDiagnosticsController(
            () => 0,
            () => 0,
            () => `cleared-probe-${++nextId}`,
        );
        const chatBinding = controller.bindSurface("chat");
        const stoppedCancel = jest.fn();
        const stopped = controller.start();
        controller.armCancellationProbe(stopped.sessionId);
        expect(chatBinding.scheduleArmedGraphWorkerCancellation("chat", stoppedCancel)).toBe(true);
        controller.stop(stopped.sessionId);

        await Promise.resolve();
        await Promise.resolve();

        expect(stoppedCancel).not.toHaveBeenCalled();
        const cleared = controller.start();
        controller.armCancellationProbe(cleared.sessionId);
        controller.clear();
        expect(chatBinding.scheduleArmedGraphWorkerCancellation("chat", jest.fn())).toBe(false);
        expect(() => controller.snapshot(cleared.sessionId)).toThrow(/unavailable or stale/i);
    });
});

describe("retrieval diagnostic outcome classification", () => {
    test.each([
        [undefined, undefined, { outcome: "completed" }],
        ["local_budget", undefined, { outcome: "fallback", reason: "local_budget" }],
        ["deadline", undefined, { outcome: "deadline", reason: "deadline" }],
        ["aborted", undefined, { outcome: "aborted", reason: "aborted" }],
        ["invalid_graph", undefined, { outcome: "fallback", reason: "invalid_graph" }],
        [undefined, "graph_budget", { outcome: "fallback", reason: "graph_budget" }],
        ["local_budget", "deadline", { outcome: "deadline", reason: "deadline" }],
    ] as const)("combines Local=%s and graph=%s", (local, graph, expected) => {
        expect(resolveGraphPreflightDiagnostic(local, graph)).toEqual(expected);
    });

    test("classifies Worker cancellation as aborted even without parent abort", () => {
        expect(resolveGraphWorkerFailureOutcome("graph-rank-aborted", false, false)).toBe("aborted");
        expect(resolveGraphWorkerFailureOutcome("graph-rank-worker-error", false, false)).toBe("failed");
        expect(resolveGraphWorkerFailureOutcome("graph-rank-deadline", false, true)).toBe("deadline");
    });

    test("suppresses only the duplicate cooperative-abort terminal", () => {
        expect(shouldRecordGraphWorkerFailureTerminal("graph-rank-aborted", 1)).toBe(false);
        expect(shouldRecordGraphWorkerFailureTerminal("graph-rank-aborted", 0)).toBe(true);
        expect(shouldRecordGraphWorkerFailureTerminal("graph-rank-deadline", 1)).toBe(true);
        expect(shouldRecordGraphWorkerFailureTerminal("graph-rank-worker-error", 1)).toBe(true);
    });
});
