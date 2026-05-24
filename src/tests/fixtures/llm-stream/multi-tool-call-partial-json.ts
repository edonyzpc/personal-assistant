import type { RecordedLlmStreamFixture } from "./types";

export const multiToolCallPartialJsonFixture: RecordedLlmStreamFixture = {
    name: "multi-tool-call-partial-json",
    description: "Model streams multiple tool calls with JSON arguments split across chunks.",
    chunks: [
        {
            content: "",
            tool_call_chunks: [
                {
                    id: "call_memory_2",
                    index: 0,
                    name: "search_memory",
                    args: "{\"query\":\"road",
                },
            ],
        },
        {
            content: "",
            tool_call_chunks: [
                {
                    id: "call_memory_2",
                    index: 0,
                    args: "map\"}",
                },
                {
                    id: "call_current_1",
                    index: 1,
                    name: "get_current_note_context",
                    args: "{\"mode\":\"metadata\"}",
                },
            ],
        },
    ],
};
