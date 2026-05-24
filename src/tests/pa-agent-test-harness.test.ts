import { describe, expect, it } from "@jest/globals";
import { AIMessageChunk } from "@langchain/core/messages";

import { parseNativeToolCallsFromModelResponse } from "../ai-services/chat-agent";
import {
    TEST_CHAT_TOOL_NAMES,
    createTestToolRegistry,
} from "./factories";
import {
    FakeChatModelProvider,
    createFailingFakeChatModelProvider,
    type FakeChatModel,
    type FakeProviderFailureMode,
} from "./fakes";
import {
    directAnswerFixture,
    multiToolCallPartialJsonFixture,
    recordAiMessageStream,
    replayAiMessageStream,
    serializeAiMessageChunk,
    singleToolCallFixture,
} from "./fixtures/llm-stream";

describe("PA Agent SPEC-00b test harness", () => {
    it("records and replays LangChain AIMessageChunk streams", async () => {
        const recorded = await recordAiMessageStream(
            "direct-answer-copy",
            "Round-trip recording of the direct answer fixture.",
            replayAiMessageStream(directAnswerFixture),
        );

        expect(recorded.chunks).toEqual(directAnswerFixture.chunks);

        const replayed = [];
        for await (const chunk of replayAiMessageStream(recorded)) {
            expect(AIMessageChunk.isInstance(chunk)).toBe(true);
            replayed.push(serializeAiMessageChunk(chunk));
        }

        expect(replayed).toEqual(directAnswerFixture.chunks);
    });

    it("ships the initial direct, single-tool, and multi-tool stream fixtures", async () => {
        const fixtures = [
            directAnswerFixture,
            singleToolCallFixture,
            multiToolCallPartialJsonFixture,
        ];

        expect(fixtures.map((fixture) => fixture.name)).toEqual([
            "direct-answer",
            "single-tool-call",
            "multi-tool-call-partial-json",
        ]);
        expect(directAnswerFixture.chunks.flatMap((chunk) => chunk.tool_call_chunks ?? [])).toEqual([]);

        const singleToolChunks = singleToolCallFixture.chunks.flatMap((chunk) => chunk.tool_call_chunks ?? []);
        expect(parseNativeToolCallsFromModelResponse({ tool_call_chunks: singleToolChunks })).toEqual({
            ok: true,
            calls: [{
                id: "call_memory_1",
                name: "search_memory",
                input: { query: "project launch notes" },
                index: 0,
            }],
        });

        const multiToolChunks = multiToolCallPartialJsonFixture.chunks.flatMap((chunk) => chunk.tool_call_chunks ?? []);
        expect(parseNativeToolCallsFromModelResponse({ tool_call_chunks: multiToolChunks })).toEqual({
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
    });

    it("creates ToolRegistry fixtures with stable provider schema order", () => {
        const registry = createTestToolRegistry();
        const schemaNamesByTurn = [
            registry.exportProviderSchemas().map((schema) => schema.function.name),
            registry.exportProviderSchemas().map((schema) => schema.function.name),
            registry.exportProviderSchemas().map((schema) => schema.function.name),
        ];

        expect(schemaNamesByTurn).toEqual([
            TEST_CHAT_TOOL_NAMES,
            TEST_CHAT_TOOL_NAMES,
            TEST_CHAT_TOOL_NAMES,
        ]);
    });

    it("provides fake planner dependencies with invoke and stream scripts", async () => {
        const provider = new FakeChatModelProvider([
            { invokeResponse: { content: "{\"action\":\"answer\",\"reason\":\"fixture\"}" } },
            { streamFixture: singleToolCallFixture },
        ]);
        const dependencies = provider.toChatPlannerDependencies();
        const invokeModel = await dependencies.createChatModel(0.1, { transport: "obsidian" }) as unknown as FakeChatModel;
        const streamModel = await dependencies.createChatModel(0.2, { transport: "obsidian" }) as unknown as FakeChatModel;

        expect(await invokeModel.invoke({ input: "plan" })).toEqual({
            content: "{\"action\":\"answer\",\"reason\":\"fixture\"}",
        });

        const streamed = [];
        for await (const chunk of streamModel.stream({ input: "stream" })) {
            streamed.push(serializeAiMessageChunk(chunk));
        }

        expect(streamed).toEqual(singleToolCallFixture.chunks);
        expect(provider.createChatModelCalls).toEqual([
            { temperature: 0.1, options: { transport: "obsidian" } },
            { temperature: 0.2, options: { transport: "obsidian" } },
        ]);
    });

    it("simulates unavailable, timeout, and protocol provider failures", async () => {
        for (const failure of ["unavailable", "timeout", "protocol-error"] satisfies FakeProviderFailureMode[]) {
            const provider = createFailingFakeChatModelProvider(failure);
            const model = await provider.toChatPlannerDependencies()
                .createChatModel(0.1, { transport: "obsidian" }) as unknown as FakeChatModel;

            await expect(model.invoke({ input: "plan" })).rejects.toMatchObject({
                name: expectedFailureName(failure),
            });
        }
    });
});

function expectedFailureName(failure: FakeProviderFailureMode): string {
    if (failure === "timeout") return "TimeoutError";
    if (failure === "protocol-error") return "ProtocolError";
    return "ProviderUnavailableError";
}
