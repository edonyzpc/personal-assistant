# PA Agent Tool-Call Protocol Matrix

This matrix is the SPEC-02 contract for streamed provider tool calls before the PA Agent answer-stream runtime replaces the current Ralpha planning path.

| Provider | Transport | Streaming Tool Calls | Tool Call ID | Earliest Observable Turn Shape | Fallback Path |
| --- | --- | --- | --- | --- | --- |
| OpenAI | OpenAI-compatible stream | Supported through LangChain `AIMessageChunk.tool_call_chunks` and `additional_kwargs.tool_calls` fixtures. | Preserved when provider emits `id`; fixtures assert `call_memory_1` and split multi-call IDs. | First streamed AI chunk can contain visible text or `tool_call_chunks`. | None for validated OpenAI-compatible stream fixtures; before-visible-output transport fallback remains a runtime concern. |
| Qwen | DashScope OpenAI-compatible stream | Supported only for validated DashScope-compatible model/baseURL combinations. | Preserved when DashScope emits OpenAI-compatible `id`; fixtures use the same parser contract as OpenAI-compatible chunks. | First streamed AI chunk can contain visible text or `tool_call_chunks`. | Provider is declined by native capability gate when model/baseURL is unvalidated; current fallback is gathered-context/JSON planning. |
| Ollama | Ollama chat | Declined for streamed PA Agent v1 tool calls. | Not accepted for PA Agent streaming until fixtures prove stable IDs and chunk semantics. | No approved streamed tool-call chunk shape. | JSON planning loop. Non-streaming transport can be reconsidered only with provider fixtures. |

Rules:

- Supported providers must pass direct-answer, single-tool-call, and multi-tool-call-with-partial-JSON fixtures.
- Declined providers must have an explicit fallback path test.
- The current Ralpha stream path keeps late registered tool calls after visible output as `partial-output-error`.
- The future PA Agent answer-stream path replaces that with segment boundaries: `thinking`, `answering`, and `tool-calling`.
- Abort during stream fixture replay must throw `AbortError` before yielding further chunks.
