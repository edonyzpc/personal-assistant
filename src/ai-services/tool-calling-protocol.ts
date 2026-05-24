export type ToolCallingProtocolProvider = "openai" | "qwen" | "ollama";
export type ToolCallingTransport = "openai-compatible-stream" | "ollama-chat";
export type ToolCallingFallbackPath = "none" | "json-planning-loop" | "non-streaming-transport";
export type LateToolCallPolicy = "partial-output-error" | "segment-boundary";

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
    {
        provider: "ollama",
        transport: "ollama-chat",
        streamingToolCalls: false,
        preservesToolCallId: false,
        earliestObservableTurnShape: "No validated streamed tool-call chunk shape for PA Agent v1",
        fallbackPath: "json-planning-loop",
        notes: "Declined for streamed PA Agent tool calls until a provider fixture proves stable IDs and chunk semantics.",
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

export function getLateToolCallPolicy(runtimePath: "current-ralpha" | "pa-agent-answer-stream"): LateToolCallPolicy {
    return runtimePath === "pa-agent-answer-stream" ? "segment-boundary" : "partial-output-error";
}
