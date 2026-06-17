import { describe, expect, it, jest } from "@jest/globals";

import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import type { PaAgentModelStreamChunk } from "../src/ai-services/pa-agent-loop";

type FallbackArgs = Parameters<typeof streamWithInvokeFallback>[0];
type ChainStream = FallbackArgs["chain"]["stream"];
type ChainInvoke = FallbackArgs["chain"]["invoke"];

function drain(generator: AsyncGenerator<PaAgentModelStreamChunk, void, unknown>): Promise<PaAgentModelStreamChunk[]> {
    return (async () => {
        const collected: PaAgentModelStreamChunk[] = [];
        for await (const chunk of generator) {
            collected.push(chunk);
        }
        return collected;
    })();
}

function makeChain(overrides: {
    stream?: ChainStream;
    invoke?: ChainInvoke;
}): FallbackArgs["chain"] {
    return {
        stream: overrides.stream ?? (async function* () { /* empty */ }),
        invoke: overrides.invoke ?? (async () => ({})),
    };
}

describe("streamWithInvokeFallback (P0-D)", () => {
    it("yields stream chunks unchanged when streaming succeeds and never calls invoke()", async () => {
        const invoke = jest.fn(async () => ({ content: "should not be called" }));
        const chain = makeChain({
            stream: async function* () {
                yield { content: "hello " };
                yield { content: "world" };
            },
            invoke,
        });

        const chunks = await drain(streamWithInvokeFallback({ chain, input: {} }));

        expect(chunks).toEqual([
            { type: "text_delta", text: "hello " },
            { type: "text_delta", text: "world" },
        ]);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("emits provider usage diagnostics from streaming chunks", async () => {
        const chain = makeChain({
            stream: async function* () {
                yield {
                    content: "hello",
                    usage_metadata: {
                        input_tokens: 12,
                        output_tokens: 3,
                        total_tokens: 15,
                    },
                };
            },
        });

        const chunks = await drain(streamWithInvokeFallback({ chain, input: {} }));

        expect(chunks).toEqual([
            {
                type: "diagnostic",
                diagnostic: {
                    type: "provider_usage",
                    usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
                },
            },
            { type: "text_delta", text: "hello" },
        ]);
    });

    it("falls back to invoke() when chain.stream() rejects before any chunk is yielded", async () => {
        const invokeCalls: Array<[unknown, { signal?: AbortSignal } | undefined]> = [];
        const invoke: ChainInvoke = async (input, opts) => {
            invokeCalls.push([input, opts]);
            return { content: "fallback answer" };
        };
        const onFallback = jest.fn();
        const chain = makeChain({
            stream: () => {
                throw new Error("stream setup failed");
            },
            invoke,
        });

        const chunks = await drain(
            streamWithInvokeFallback({ chain, input: { foo: "bar" }, onFallback }),
        );

        expect(chunks).toEqual([{ type: "text_delta", text: "fallback answer" }]);
        expect(invokeCalls).toEqual([[{ foo: "bar" }, undefined]]);
        expect(onFallback).toHaveBeenCalledTimes(1);
        expect(onFallback).toHaveBeenCalledWith("stream_setup_failed", expect.objectContaining({ message: "stream setup failed" }));
    });

    it("emits provider usage diagnostics from invoke fallback responses", async () => {
        const chain = makeChain({
            stream: () => {
                throw new Error("stream failed");
            },
            invoke: async () => ({
                content: "fallback answer",
                response_metadata: {
                    tokenUsage: {
                        promptTokens: 20,
                        completionTokens: 5,
                    },
                },
            }),
        });

        const chunks = await drain(streamWithInvokeFallback({ chain, input: {} }));

        expect(chunks).toEqual([
            {
                type: "diagnostic",
                diagnostic: {
                    type: "provider_usage",
                    usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
                },
            },
            { type: "text_delta", text: "fallback answer" },
        ]);
    });

    it("falls back to invoke() when the stream iterator throws before yielding visible output", async () => {
        let invokeCount = 0;
        const invoke: ChainInvoke = async () => {
            invokeCount += 1;
            return { content: "recovered" };
        };
        const onFallback = jest.fn();
        const chain = makeChain({
            stream: async function* () {
                throw new Error("first-chunk read failed");
            },
            invoke,
        });

        const chunks = await drain(
            streamWithInvokeFallback({ chain, input: {}, onFallback }),
        );

        expect(chunks).toEqual([{ type: "text_delta", text: "recovered" }]);
        expect(invokeCount).toBe(1);
        expect(onFallback).toHaveBeenCalledWith("stream_iteration_failed", expect.any(Error));
    });

    it("rethrows mid-stream failures that occur AFTER visible output (no fallback duplication)", async () => {
        let invokeCount = 0;
        const invoke: ChainInvoke = async () => {
            invokeCount += 1;
            return { content: "should not duplicate" };
        };
        const chain = makeChain({
            stream: async function* () {
                yield { content: "partial " };
                throw new Error("upstream dropped");
            },
            invoke,
        });

        const generator = streamWithInvokeFallback({ chain, input: {} });

        await expect((async () => {
            for await (const _chunk of generator) {
                // consume until throw
            }
        })()).rejects.toThrow("upstream dropped");
        expect(invokeCount).toBe(0);
    });

    it("rethrows AbortError without invoking the fallback when the user aborted", async () => {
        let invokeCount = 0;
        const invoke: ChainInvoke = async () => {
            invokeCount += 1;
            return {};
        };
        const controller = new AbortController();
        controller.abort();
        const chain = makeChain({
            stream: () => {
                const error = new Error("aborted");
                (error as Error & { name?: string }).name = "AbortError";
                throw error;
            },
            invoke,
        });

        await expect(drain(
            streamWithInvokeFallback({ chain, input: {}, signal: controller.signal }),
        )).rejects.toMatchObject({ name: "AbortError" });
        expect(invokeCount).toBe(0);
    });

    it("propagates the abort signal into chain.invoke() during fallback so the retry stays cancellable", async () => {
        const seenSignals: Array<AbortSignal | undefined> = [];
        const controller = new AbortController();
        const chain = makeChain({
            stream: () => {
                throw new Error("stream failed");
            },
            invoke: async (_input, opts) => {
                seenSignals.push(opts?.signal);
                return { content: "after fallback" };
            },
        });

        await drain(streamWithInvokeFallback({ chain, input: {}, signal: controller.signal }));

        expect(seenSignals).toEqual([controller.signal]);
    });

    it("reuses the caller-provided streamedToolNames map across the fallback boundary", async () => {
        const map = new Map<string, string>();
        const chain = makeChain({
            stream: () => {
                throw new Error("stream failed");
            },
            invoke: async () => ({
                content: "ok",
                tool_calls: [{ id: "call_1", function: { name: "search_memory", arguments: '{"query":"x"}' } }],
            }),
        });

        const chunks = await drain(streamWithInvokeFallback({
            chain,
            input: {},
            streamedToolNames: map,
        }));

        const toolDeltas = chunks.filter((chunk) => chunk.type === "toolcall_delta");
        expect(toolDeltas.length).toBeGreaterThan(0);
        // The map was mutated by getCanonicalToolCallDeltas during fallback — proof that the same
        // accumulator was threaded through rather than being silently reset on retry.
        expect(map.size).toBeGreaterThan(0);
    });

    it("propagates invoke rejection when fallback invoke itself fails (no infinite retry)", async () => {
        const onFallback = jest.fn();
        const chain = makeChain({
            stream: () => {
                throw new Error("stream failed");
            },
            invoke: async () => {
                throw new Error("invoke also failed");
            },
        });

        await expect(drain(
            streamWithInvokeFallback({ chain, input: {}, onFallback }),
        )).rejects.toThrow("invoke also failed");
        expect(onFallback).toHaveBeenCalledTimes(1);
    });

    it("does not fallback when thinking_delta was already yielded before the stream breaks", async () => {
        let invokeCount = 0;
        const chain = makeChain({
            stream: async function* () {
                yield { additional_kwargs: { reasoning_content: "let me think..." } };
                throw new Error("stream broke after thinking");
            },
            invoke: async () => {
                invokeCount += 1;
                return { content: "should not be called" };
            },
        });

        await expect(drain(
            streamWithInvokeFallback({ chain, input: {} }),
        )).rejects.toThrow("stream broke after thinking");
        expect(invokeCount).toBe(0);
    });
});
