export type ToolCallingProtocolProvider = "openai" | "qwen";
export type ToolCallingTransport = "openai-compatible-stream";
export type ToolCallingFallbackPath = "none" | "json-planning-loop" | "non-streaming-transport";

export interface ToolCallingProtocolSpec {
    provider: ToolCallingProtocolProvider;
    transport: ToolCallingTransport;
    streamingToolCalls: boolean;
    preservesToolCallId: boolean;
    earliestObservableTurnShape: string;
    fallbackPath: ToolCallingFallbackPath;
    notes: string;
}

export const TOOL_CALLING_PROTOCOL_MATRIX: readonly ToolCallingProtocolSpec[] = [
    {
        provider: "openai",
        transport: "openai-compatible-stream",
        streamingToolCalls: true,
        preservesToolCallId: true,
        earliestObservableTurnShape: "AIMessageChunk.tool_call_chunks or additional_kwargs.tool_calls",
        fallbackPath: "none",
        notes: "Supported for PA Agent fixtures through LangChain AIMessageChunk tool_call_chunks.",
    },
    {
        provider: "qwen",
        transport: "openai-compatible-stream",
        streamingToolCalls: true,
        preservesToolCallId: true,
        earliestObservableTurnShape: "AIMessageChunk.tool_call_chunks from DashScope OpenAI-compatible streaming",
        fallbackPath: "none",
        notes: "Supported only for validated DashScope-compatible model/baseURL combinations.",
    },
];

export function getToolCallingProtocolSpec(provider: string): ToolCallingProtocolSpec {
    const normalized = provider.trim().toLowerCase();
    const spec = TOOL_CALLING_PROTOCOL_MATRIX.find((entry) => entry.provider === normalized);
    if (spec) return spec;
    return {
        provider: normalized as ToolCallingProtocolProvider,
        transport: "openai-compatible-stream",
        streamingToolCalls: false,
        preservesToolCallId: false,
        earliestObservableTurnShape: "Unknown provider; no streamed tool-call fixture is approved.",
        fallbackPath: "json-planning-loop",
        notes: "Unknown providers must not enter PA Agent streamed tool-call mode by default.",
    };
}

