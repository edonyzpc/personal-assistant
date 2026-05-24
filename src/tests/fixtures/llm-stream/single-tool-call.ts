import type { RecordedLlmStreamFixture } from "./types";

export const singleToolCallFixture: RecordedLlmStreamFixture = {
    name: "single-tool-call",
    description: "Model streams one complete tool call chunk.",
    chunks: [{
        content: "",
        tool_call_chunks: [{
            id: "call_memory_1",
            index: 0,
            name: "search_memory",
            args: "{\"query\":\"project launch notes\"}",
        }],
    }],
};
