import { describe, expect, it, jest } from "@jest/globals";
import { PaAgentLoop, type PaAgentLoopOptions, type PaAgentTurnSummary } from "../src/ai-services/pa-agent-loop";
import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import protocolTrace from "./fixtures/b135-writing-protocol-trace.json";
import identityTrace from "./fixtures/b135-native-identity-trace.json";
import type { PaAgentModelInput } from "../src/ai-services/pa-agent-loop";

const trace = protocolTrace.results.find((result) => result.mode === "native")!;
const nativeWriting = { contextHandle: "b135-probe", maxTextChars: 20_000, isCurrent: () => true };
const tool = (args = trace.rawArguments, id = "call-1", index = 0, name = "present_writing") => ({
    tool_call_chunks: [{ id, index, name, args }],
});
const finish = (reason = "tool_calls") => ({ response_metadata: { finish_reason: reason } });

async function run(chunks: unknown[], options: Partial<PaAgentLoopOptions> = {}, tail?: () => void) {
    const execute = jest.fn<NonNullable<PaAgentLoopOptions["toolExecutor"]>["execute"]>();
    const prepareBatch = jest.fn<NonNullable<NonNullable<PaAgentLoopOptions["toolExecutor"]>["prepareBatch"]>>();
    const requests: string[] = [];
    const modelInputs: PaAgentModelInput[] = [];
    const loop = new PaAgentLoop({
        runId: "native-loop", userInput: "Write the requested work", nativeWriting,
        toolExecutor: { execute, prepareBatch },
        model: { stream: (input) => {
            modelInputs.push(input);
            requests.push(input.toolMode ?? "normal");
            return streamWithInvokeFallback({ captureToolIdentity: true, input: {}, chain: {
                stream: async function* () { for (const chunk of chunks) yield chunk; tail?.(); },
                invoke: async () => { throw new Error("unexpected fallback"); },
            } });
        } }, ...options,
    });
    return { result: await loop.run(), execute, prepareBatch, requests, modelInputs };
}

describe("host-enabled native writing loop", () => {
    it("freezes a dynamic colon handle once for the response", async () => {
        let handle = "run:writing:1";
        const getContextHandle = jest.fn(() => handle);
        const outcome = await run([tool(JSON.stringify({ body: "Work", contextHandle: handle })), finish()], {
            nativeWriting: { ...nativeWriting, getContextHandle },
            prepareModelInput: async (input) => { handle = "run:writing:2"; return input; },
        });
        expect(outcome.result.status).toBe("completed");
        expect(getContextHandle).toHaveBeenCalledTimes(1);
        expect(outcome.result.transcript.at(-1)).toMatchObject({ content: [
            { input: JSON.stringify({ body: "Work", contextHandle: "run:writing:1" }) },
        ] });
    });

    it.each([false, true])("rejects output mixed with preparation before any dispatch (prepare first: %s)", async (first) => {
        const prepare = tool("{}", "prepare", 1, "get_writing_context");
        const outcome = await run([...(first ? [prepare, tool()] : [tool(), prepare]), finish()], {
            nativeWriting: { ...nativeWriting, getContextHandle: () => undefined },
        });
        expect(outcome.result.status).toBe("incomplete");
        expect(outcome.modelInputs[0].controlSnapshot?.writingOutput).toBeUndefined();
        expect(outcome.prepareBatch).not.toHaveBeenCalled();
        expect(outcome.execute).not.toHaveBeenCalled();
    });

    it("does not fall back to the fixed handle when preparation is unavailable", async () => {
        const outcome = await run([tool(), finish()], {
            nativeWriting: { ...nativeWriting, getContextHandle: () => undefined },
        });
        expect(outcome.result.status).toBe("incomplete");
        expect(outcome.modelInputs[0].controlSnapshot?.writingOutput).toBeUndefined();
        expect(outcome.execute).not.toHaveBeenCalled();
    });
    it("declares pure output separately from source/action allowances in the reserved final turn", async () => {
        const outcome = await run([tool(), finish()], {
            now: () => 75, runStartedAt: 0, maxWallClockMs: 100, finalizationReserveMs: 30,
        });
        expect(outcome.result.status).toBe("completed");
        expect(outcome.modelInputs).toHaveLength(1);
        expect(outcome.modelInputs[0]).toMatchObject({ toolMode: "final_answer_only", controlSnapshot: {
            writingOutput: "present_writing", sourceScope: "none", exposureMode: "final-only",
        } });
        expect(outcome.modelInputs[0].runtimeInstruction).toContain("no source, context or action calls");
        expect(outcome.prepareBatch).not.toHaveBeenCalled();
        expect(outcome.execute).not.toHaveBeenCalled();
    });
    it("replays the actual SDK identity stream including its null-id closing placeholder", async () => {
        const outcome = await run([...identityTrace.deltas.map((delta) => ({ tool_call_chunks: [delta] })), finish()], {
            nativeWriting: { ...nativeWriting, contextHandle: "b135-identity" },
        });
        expect(outcome.result.status).toBe("completed");
        expect(outcome.requests).toHaveLength(1);
        expect(outcome.execute).not.toHaveBeenCalled();
        expect(outcome.prepareBatch).not.toHaveBeenCalled();
        expect(outcome.result.transcript.at(-1)).toMatchObject({ content: [
            { type: "toolCall", name: "present_writing", id: identityTrace.deltas[0].id },
        ] });
    });

    it("binds an index introduced later without changing the stable call identity", async () => {
        const outcome = await run([
            { tool_call_chunks: [{ id: "call-1", name: "present_", args: "" }] },
            { tool_call_chunks: [{ id: "call-1", index: 2, name: "", args: "" }] },
            { tool_call_chunks: [{ index: 2, name: "writing", args: trace.rawArguments }] }, finish(),
        ]);
        expect(outcome.result.status).toBe("completed");
        expect(outcome.result.transcript.at(-1)).toMatchObject({ content: [
            { type: "toolCall", id: "call-1", index: 2, name: "present_writing", input: trace.rawArguments },
        ] });
    });

    it.each(["setup", "iteration"])("retains raw identity through %s invoke fallback", async (failure) => {
        const invoke = jest.fn(async () => ({ tool_calls: [{ id: "call-invoke", name: "present_writing",
            args: JSON.parse(trace.rawArguments),
        }], ...finish() }));
        const outcome = await run([], { model: { stream: () => streamWithInvokeFallback({
            captureToolIdentity: true, input: {}, chain: {
                stream: failure === "setup" ? () => { throw new Error("stream not supported"); }
                    : async function* () { throw new Error("stream not supported"); },
                invoke,
            },
        }) } });
        expect(outcome.result.status).toBe("completed");
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(outcome.execute).not.toHaveBeenCalled();
    });

    it.each(["present_", ""])("keeps explanatory text and resolves the final name after a %j header", async (name) => {
        const outcome = await run([
            { content: "Here is the work." },
            { tool_call_chunks: [{ id: "call-1", index: 2, name, args: "" }] },
            { tool_call_chunks: [{ index: 2, name: name ? "writing" : "present_writing", args: trace.rawArguments }] },
            finish(),
        ]);
        expect(outcome.result.status).toBe("completed");
        expect(outcome.result.transcript.at(-1)).toMatchObject({ content: [
            { type: "text", text: "Here is the work." },
            { type: "toolCall", name: "present_writing", input: trace.rawArguments, index: 2 },
        ] });
        expect(outcome.execute).not.toHaveBeenCalled();
    });

    it("finishes one exact output without prepare, execute, tool results or acknowledgement", async () => {
        const afterTurn = jest.fn(async (summary: PaAgentTurnSummary) => {
            expect(summary.nativeWriting).toEqual({ body: trace.expected, explanation: "" });
            expect(summary.toolCalls).toHaveLength(1);
            return { action: "stop" as const, status: "completed" as const, reason: "accepted" };
        });
        const chunks = trace.argumentDeltas.map((args, index) => ({ tool_call_chunks: [{ index: 0, args,
            ...(index === 0 ? { id: "call-1", name: "present_writing" } : {}),
        }] }));
        const outcome = await run([{ content: "Here is the work." }, ...chunks, finish()], { hostPolicy: { afterTurn } });
        expect(outcome.result.status).toBe("completed");
        expect(outcome.requests).toHaveLength(1);
        expect(outcome.prepareBatch).not.toHaveBeenCalled();
        expect(outcome.execute).not.toHaveBeenCalled();
        expect(outcome.result.transcript.filter((message) => message.role === "toolResult")).toHaveLength(0);
        expect(outcome.result.transcript.at(-1)).toMatchObject({ content: expect.arrayContaining([
            { type: "text", text: "Here is the work." },
        ]), providerCompletion: "tool_calls" });
        expect(afterTurn).toHaveBeenCalledTimes(1);
    });

    it.each([
        [tool(), tool("{}", "call-2", 1, "read_file"), finish()],
        [tool("{}", "call-2", 1, "write_file"), tool(), finish()],
        [tool(), tool(trace.rawArguments, "call-2", 1), finish()],
        [tool(), tool("", "call-2", 0), finish()],
        [tool(), tool("", "call-1", 1), finish()],
        [tool(), tool("", "call-1", 0, "read_file"), finish()],
        [tool(trace.rawArguments.slice(0, -1)), finish()],
        [tool(), finish("stop")], [tool(), finish("length")], [tool()],
    ])("rejects mixed, conflicting or incomplete output without any tool side effect", async (...chunks) => {
        const outcome = await run(chunks);
        expect(outcome.result.status).not.toBe("completed");
        expect(outcome.requests).toHaveLength(1);
        expect(outcome.prepareBatch).not.toHaveBeenCalled();
        expect(outcome.execute).not.toHaveBeenCalled();
    });

    it("does not wait for an optional transport tail after complete pure output", async () => {
        const tail = jest.fn(() => { throw new Error("usage tail lost"); });
        const outcome = await run([tool(), finish()], {}, tail);
        expect(outcome.result.status).toBe("completed");
        expect(outcome.requests).toHaveLength(1);
        expect(outcome.result.transcript.at(-1)).toMatchObject({ stopReason: "tool_calls", providerCompletion: "tool_calls" });
        expect(tail).not.toHaveBeenCalled();
    });

    it.each(["reject", "continue"])("respects host %s without dispatching another generation", async (choice) => {
        const afterTurn = jest.fn(async () => choice === "continue"
            ? { action: "continue" as const, reason: "needs_follow_up" as const }
            : { action: "stop" as const, status: "incomplete" as const, reason: "source_not_supported" });
        const outcome = await run([tool(), finish()], { hostPolicy: { afterTurn } });
        expect(outcome.result.status).toBe("incomplete");
        expect(outcome.requests).toHaveLength(1);
        expect(afterTurn).toHaveBeenCalledTimes(1);
    });

    it("rechecks the current source after async host policy evaluation", async () => {
        let current = true;
        const outcome = await run([tool(), finish()], {
            nativeWriting: { ...nativeWriting, isCurrent: () => current },
            hostPolicy: { afterTurn: async () => { current = false; return { action: "stop", status: "completed", reason: "done" }; } },
        });
        expect(outcome.result.status).toBe("incomplete");
    });

    it("uses the reserved final turn and still invokes ordinary host policy when no terminal hook exists", async () => {
        const afterTurn = jest.fn(async () => ({ action: "stop" as const, status: "completed" as const, reason: "accepted" }));
        const outcome = await run([tool(), finish()], {
            now: () => 75, runStartedAt: 0, maxWallClockMs: 100, finalizationReserveMs: 30,
            hostPolicy: { afterTurn },
        });
        expect(outcome.requests).toEqual(["final_answer_only"]);
        expect(outcome.result.status).toBe("completed");
        expect(afterTurn).toHaveBeenCalledTimes(1);
        expect(outcome.execute).not.toHaveBeenCalled();
    });

    it("does not turn an output into completion after user cancellation", async () => {
        const controller = new AbortController();
        const outcome = await run([tool(), finish()], { signal: controller.signal,
            hostPolicy: { afterTurn: async () => {
                controller.abort();
                return { action: "stop", status: "completed", reason: "done" };
            } },
        });
        expect(outcome.result.status).toBe("aborted");
        expect(outcome.execute).not.toHaveBeenCalled();
    });

    it.each([[80, "completed"], [110, "incomplete"]] as const)(
        "keeps the original hard deadline when native output finishes at %s ms", async (finishAt, status) => {
            jest.useFakeTimers();
            jest.setSystemTime(0);
            try {
                const pending = run([], {
                    maxWallClockMs: 100, finalizationReserveMs: 30, runStartedAt: 0,
                    model: { stream: () => streamWithInvokeFallback({ captureToolIdentity: true, input: {}, chain: {
                        stream: async function* () {
                            yield tool();
                            await new Promise((resolve) => setTimeout(resolve, finishAt));
                            yield finish();
                        },
                        invoke: async () => { throw new Error("must not retry"); },
                    } }) },
                });
                await jest.advanceTimersByTimeAsync(120);
                const outcome = await pending;
                expect(outcome.result.status).toBe(status);
                expect(outcome.execute).not.toHaveBeenCalled();
                expect(outcome.prepareBatch).not.toHaveBeenCalled();
            } finally { jest.useRealTimers(); }
        },
    );

    it("preserves time for asynchronous host admission instead of waiting for optional EOF", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        let tailRead = false;
        const afterTurn = jest.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { action: "stop" as const, status: "completed" as const, reason: "verified" };
        });
        try {
            const pending = run([], {
                maxWallClockMs: 100, finalizationReserveMs: 30, runStartedAt: 0, hostPolicy: { afterTurn },
                model: { stream: () => streamWithInvokeFallback({ captureToolIdentity: true, input: {}, chain: {
                    stream: async function* () {
                        yield tool();
                        yield finish();
                        tailRead = true;
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    },
                    invoke: async () => { throw new Error("must not retry"); },
                } }) },
            });
            await jest.advanceTimersByTimeAsync(30);
            const outcome = await pending;
            expect(outcome.result.status).toBe("completed");
            expect(afterTurn).toHaveBeenCalledTimes(1);
            expect(tailRead).toBe(false);
        } finally { jest.useRealTimers(); }
    });
});
