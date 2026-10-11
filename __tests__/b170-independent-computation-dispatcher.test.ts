import { describe, expect, it } from "@jest/globals";

import { AgentLifecycleEventEmitter } from "../src/ai-services/agent-runtime-primitives";
import type { PaAgentMessage } from "../src/ai-services/chat-types";
import type { PaAgentToolExecutionResult } from "../src/ai-services/pa-agent-types";
import { ToolExecutionDispatcher } from "../src/ai-services/pa-agent-tool-dispatcher";

type Fixture = {
    emitted: PaAgentToolExecutionResult[];
    run: () => Promise<Awaited<ReturnType<ToolExecutionDispatcher["executeBufferedToolCalls"]>>>;
};

function createFixture(options: {
    timeoutMs: number;
    wallClockRemainingMs?: number;
    retrySafety?: "read_only" | "side_effect";
    execute: (context: { outerToolDeadlineAt?: number; advanceNow: (ms: number) => void; invalidateGuard: () => void }) => Promise<PaAgentToolExecutionResult>;
}) {
    let now = 0;
    let guardCurrent = true;
    const emitted: PaAgentToolExecutionResult[] = [];
    const dispatcher = new ToolExecutionDispatcher({
        toolExecutionMode: "parallel",
        runId: "b170-independent-run",
        userInput: "independent deadline and facts",
        toolTimeoutMs: 1_000,
        toolTimeoutOutcome: "recoverable_error",
        toolAbortGraceMs: 1,
        maxToolCalls: 10,
        now: () => now,
        isAborted: () => false,
        isWallClockExceeded: () => false,
        wallClockRemainingMs: () => options.wallClockRemainingMs,
        events: new AgentLifecycleEventEmitter({ runId: "b170-independent-run", now: () => now }),
        emitToolResult: (_turnId, _toolCall, result) => {
            emitted.push(result);
            return {
                role: "toolResult",
                id: "b170-result",
                toolCallId: "b170-call",
                toolName: "execute_code",
                timestamp: now,
                isError: result.outcome !== "success",
                content: { promptText: result.promptText },
            } as Extract<PaAgentMessage, { role: "toolResult" }>;
        },
        toolExecutor: {
            getTimeoutMs: () => options.timeoutMs,
            getRetrySafety: () => options.retrySafety ?? "read_only",
            preflightBatch: () => ({
                kind: "admitted",
                taskSourceReadGuard: {
                    isCurrent: () => guardCurrent,
                    isPathAllowed: () => guardCurrent,
                },
            }),
            execute: async context => options.execute({
                outerToolDeadlineAt: context.outerToolDeadlineAt,
                advanceNow: ms => { now = ms; },
                invalidateGuard: () => { guardCurrent = false; },
            }),
        },
    });
    return {
        emitted,
        run: async () => {
            const summary = await dispatcher.executeBufferedToolCalls("turn", 0, [{
                key: "b170-call",
                id: "b170-call",
                name: "execute_code",
                input: { code: "return 1" },
                index: 0,
                hasStructuredInput: true,
                argsText: JSON.stringify({ code: "return 1" }),
                partIndex: 0,
            }], "normal", undefined);
            return summary;
        },
    } satisfies Fixture;
}

describe("B-170 outer execution boundaries", () => {
    it("uses an absolute tool-deadline checkpoint when the timer does not run", async () => {
        const fixture = createFixture({
            timeoutMs: 100,
            execute: async context => {
                expect(context.outerToolDeadlineAt).toBe(100);
                context.advanceNow(101);
                return { outcome: "success", promptText: "LATE_SUCCESS" };
            },
        });
        await fixture.run();

        expect(fixture.emitted[0]).toMatchObject({
            outcome: "recoverable_error",
            executionState: "failed",
            metadata: {
                reason: "tool_timeout",
                failureReason: "timeout",
                timeoutMs: 100,
            },
        });
        expect(fixture.emitted[0]?.promptText).not.toContain("LATE_SUCCESS");
    });

    it("uses the absolute outer wall-clock boundary when it expires first", async () => {
        const fixture = createFixture({
            timeoutMs: 100,
            wallClockRemainingMs: 50,
            execute: async context => {
                expect(context.outerToolDeadlineAt).toBe(50);
                context.advanceNow(51);
                return { outcome: "success", promptText: "LATE_SUCCESS" };
            },
        });
        const summary = await fixture.run();
        expect(summary.stoppedBy).toBe("wall_clock_exceeded");

        expect(fixture.emitted[0]).toMatchObject({
            outcome: "aborted",
            metadata: {
                reason: "wall_clock_exceeded",
                stoppedBy: "wall_clock_exceeded",
            },
        });
    });

    it("does not turn an executed computation into not_started after source invalidation", async () => {
        const fixture = createFixture({
            timeoutMs: 1_000,
            execute: async context => {
                context.invalidateGuard();
                return {
                    outcome: "success",
                    executionState: "succeeded",
                    promptText: "SENSITIVE_COMPUTED_OBSERVATION",
                };
            },
        });
        await fixture.run();

        expect(fixture.emitted[0]).toMatchObject({
            outcome: "policy_rejected",
            executionState: "succeeded",
            metadata: {
                reason: "task_source_scope_expired",
                preflightOnly: false,
                executionElapsedMs: expect.any(Number),
            },
        });
        expect(fixture.emitted[0]?.promptText).not.toContain("SENSITIVE_COMPUTED_OBSERVATION");
    });

    it("projects only finite owner facts when a side-effect result meets the wall deadline", async () => {
        const fixture = createFixture({
            timeoutMs: 1_000,
            wallClockRemainingMs: 50,
            retrySafety: "side_effect",
            execute: async context => {
                context.advanceNow(51);
                return {
                    outcome: "recoverable_error",
                    executionState: "acceptance_unknown",
                    promptText: "SENSITIVE_EFFECT_BODY",
                    previewText: "SENSITIVE_EFFECT_PREVIEW",
                    sourceRecords: [{ kind: "context-used", dedupKey: "sensitive", path: "sensitive.md" }],
                    contextUsed: [{ category: "read-only-tool", label: "Sensitive" }],
                    resultFact: { kind: "unknown", operationId: "image-operation" },
                    recovery: { code: "image_acceptance_unknown", allowedActions: ["query_operation", "needs_user"] },
                    metadata: { arbitraryOwnerField: "SENSITIVE_METADATA" },
                };
            },
        });
        const summary = await fixture.run();

        expect(summary.stoppedBy).toBe("wall_clock_exceeded");
        expect(fixture.emitted[0]).toMatchObject({
            outcome: "recoverable_error",
            executionState: "acceptance_unknown",
            resultFact: { kind: "unknown", operationId: "image-operation" },
            recovery: { code: "image_acceptance_unknown" },
            metadata: {
                reason: "wall_clock_exceeded",
                stoppedBy: "wall_clock_exceeded",
                executionState: "acceptance_unknown",
            },
        });
        expect(fixture.emitted[0]?.promptText).not.toContain("SENSITIVE_EFFECT_BODY");
        expect(fixture.emitted[0]?.previewText).toBeUndefined();
        expect(fixture.emitted[0]?.sourceRecords).toBeUndefined();
        expect(fixture.emitted[0]?.contextUsed).toBeUndefined();
        expect(fixture.emitted[0]?.metadata?.arbitraryOwnerField).toBeUndefined();
    });

    it("keeps a succeeded side-effect receipt without inventing unknown recovery at the deadline", async () => {
        const fixture = createFixture({
            timeoutMs: 1_000,
            wallClockRemainingMs: 50,
            retrySafety: "side_effect",
            execute: async context => {
                context.advanceNow(51);
                return {
                    outcome: "success",
                    executionState: "succeeded",
                    promptText: "SENSITIVE_SUCCESS_BODY",
                    previewText: "SENSITIVE_SUCCESS_PREVIEW",
                    resultFact: { kind: "applied", action: "operations", receiptId: "receipt-success" },
                    metadata: { arbitraryOwnerField: "SENSITIVE_METADATA" },
                };
            },
        });
        const summary = await fixture.run();

        expect(summary.stoppedBy).toBe("wall_clock_exceeded");
        expect(fixture.emitted[0]).toMatchObject({
            outcome: "recoverable_error",
            executionState: "succeeded",
            resultFact: { kind: "applied", action: "operations", receiptId: "receipt-success" },
            metadata: {
                reason: "wall_clock_exceeded",
                stoppedBy: "wall_clock_exceeded",
                executionState: "succeeded",
            },
        });
        expect(fixture.emitted[0]?.recovery).toBeUndefined();
        expect(fixture.emitted[0]?.promptText).not.toContain("SENSITIVE_SUCCESS_BODY");
        expect(fixture.emitted[0]?.previewText).toBeUndefined();
        expect(fixture.emitted[0]?.metadata?.arbitraryOwnerField).toBeUndefined();
    });

    it.each([
        { cause: "tool_timeout", timeoutMs: 0, wallClockRemainingMs: undefined },
        { cause: "wall_clock_exceeded", timeoutMs: 100, wallClockRemainingMs: 0 },
    ] as const)("records not_started when %s expires before executor invocation", async options => {
        const execute = jest.fn(async (): Promise<PaAgentToolExecutionResult> => ({
            outcome: "success",
            promptText: "MUST_NOT_EXECUTE",
        }));
        const fixture = createFixture({
            timeoutMs: options.timeoutMs,
            wallClockRemainingMs: options.wallClockRemainingMs,
            execute,
        });
        await fixture.run();

        expect(execute).not.toHaveBeenCalled();
        expect(fixture.emitted[0]).toMatchObject({
            executionState: "not_started",
            metadata: {
                reason: options.cause,
                ...(options.cause === "tool_timeout"
                    ? { failureReason: "timeout", timeoutMs: options.timeoutMs }
                    : { stoppedBy: "wall_clock_exceeded" }),
            },
        });
        expect(fixture.emitted[0]?.recovery).toBeUndefined();
    });

    it.each([
        { cause: "tool_timeout", timeoutMs: 100, wallClockRemainingMs: undefined, advanceTo: 101 },
        { cause: "wall_clock_exceeded", timeoutMs: 1_000, wallClockRemainingMs: 50, advanceTo: 51 },
    ] as const)("preserves an owner-returned not_started fact when %s expires after invocation", async options => {
        const execute = jest.fn(async (context: { advanceNow: (ms: number) => void }): Promise<PaAgentToolExecutionResult> => {
            context.advanceNow(options.advanceTo);
            return {
                outcome: "recoverable_error",
                executionState: "not_started",
                promptText: "SENSITIVE_NOT_STARTED_BODY",
                previewText: "SENSITIVE_NOT_STARTED_PREVIEW",
                metadata: { arbitraryOwnerField: "SENSITIVE_METADATA" },
            };
        });
        const fixture = createFixture({
            timeoutMs: options.timeoutMs,
            wallClockRemainingMs: options.wallClockRemainingMs,
            execute,
        });
        await fixture.run();

        expect(execute).toHaveBeenCalledTimes(1);
        expect(fixture.emitted[0]).toMatchObject({
            executionState: "not_started",
            metadata: {
                reason: options.cause,
                ...(options.cause === "tool_timeout"
                    ? { failureReason: "timeout", timeoutMs: options.timeoutMs }
                    : { stoppedBy: "wall_clock_exceeded" }),
            },
        });
        expect(fixture.emitted[0]?.promptText).not.toContain("SENSITIVE_NOT_STARTED_BODY");
        expect(fixture.emitted[0]?.previewText ?? "").not.toContain("SENSITIVE_NOT_STARTED_PREVIEW");
        expect(fixture.emitted[0]?.recovery).toBeUndefined();
        expect(fixture.emitted[0]?.metadata?.arbitraryOwnerField).toBeUndefined();
    });

    it("preserves an established timeout ahead of source invalidation", async () => {
        const fixture = createFixture({
            timeoutMs: 1_000,
            execute: async context => {
                context.invalidateGuard();
                return {
                    outcome: "recoverable_error",
                    executionState: "not_started",
                    promptText: "Interrupted before admission.",
                    metadata: { reason: "tool_timeout", failureReason: "timeout", timeoutMs: 999 },
                };
            },
        });
        await fixture.run();

        expect(fixture.emitted[0]).toMatchObject({
            outcome: "recoverable_error",
            executionState: "not_started",
            metadata: {
                reason: "tool_timeout",
                failureReason: "timeout",
                timeoutMs: 999,
                executionElapsedMs: expect.any(Number),
            },
        });
        expect(fixture.emitted[0]?.metadata?.preflightOnly).toBeUndefined();
    });
});
