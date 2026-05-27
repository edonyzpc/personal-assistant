import { describe, expect, it } from "@jest/globals";

import {
    getToolCallingProtocolSpec,
    TOOL_CALLING_PROTOCOL_MATRIX,
    type ToolCallingProtocolProvider,
} from "../src/ai-services/tool-calling-protocol";
import { parseNativeToolCallsFromModelResponse } from "../src/ai-services/pa-agent-runtime";
import {
    directAnswerFixture,
    multiToolCallPartialJsonFixture,
    replayAiMessageStream,
    serializeAiMessageChunk,
    singleToolCallFixture,
    type RecordedLlmStreamFixture,
} from "../src/tests/fixtures/llm-stream";

describe("PA Agent tool-call protocol matrix", () => {
    it("documents OpenAI and Qwen provider protocol decisions", () => {
        expect(TOOL_CALLING_PROTOCOL_MATRIX.map((entry) => entry.provider)).toEqual([
            "openai",
            "qwen",
        ]);
        expect(getToolCallingProtocolSpec("openai")).toMatchObject({
            streamingToolCalls: true,
            preservesToolCallId: true,
            fallbackPath: "none",
        });
        expect(getToolCallingProtocolSpec("qwen")).toMatchObject({
            streamingToolCalls: true,
            preservesToolCallId: true,
            fallbackPath: "none",
        });
    });

    it.each(["openai", "qwen"] satisfies ToolCallingProtocolProvider[])(
        "passes direct, single-tool, and multi-tool fixtures for %s",
        async (provider) => {
            expect(getToolCallingProtocolSpec(provider).streamingToolCalls).toBe(true);

            await expect(parseFixture(directAnswerFixture)).resolves.toEqual({
                ok: true,
                calls: [],
            });
            await expect(parseFixture(singleToolCallFixture)).resolves.toEqual({
                ok: true,
                calls: [{
                    id: "call_memory_1",
                    name: "search_memory",
                    input: { query: "project launch notes" },
                    index: 0,
                }],
            });
            await expect(parseFixture(multiToolCallPartialJsonFixture)).resolves.toEqual({
                ok: true,
                calls: [
                    {
                        id: "call_memory_2",
                        name: "search_memory",
                        input: { query: "roadmap" },
                        index: 0,
                    },
                    {
                        id: "call_current_1",
                        name: "get_current_note_context",
                        input: { mode: "metadata" },
                        index: 1,
                    },
                ],
            });
        },
    );

    it("aborts stream fixture replay before yielding more chunks", async () => {
        const controller = new AbortController();
        controller.abort();
        const yielded: unknown[] = [];

        await expect((async () => {
            for await (const chunk of replayAiMessageStream(singleToolCallFixture, { signal: controller.signal })) {
                yielded.push(chunk);
            }
        })()).rejects.toMatchObject({ name: "AbortError" });
        expect(yielded).toEqual([]);
    });
});

async function parseFixture(fixture: RecordedLlmStreamFixture) {
    const toolCallChunks = [];
    for await (const chunk of replayAiMessageStream(fixture)) {
        toolCallChunks.push(...(serializeAiMessageChunk(chunk).tool_call_chunks ?? []));
    }
    return parseNativeToolCallsFromModelResponse({ tool_call_chunks: toolCallChunks });
}
