# PA Agent Test Harness

This folder contains reusable test-only helpers for the PA Agent SPEC track.

## LLM Stream Fixtures

Use `src/tests/fixtures/llm-stream` for recorded LangChain `AIMessageChunk` streams.

Fixture naming:

- `direct-answer`: visible answer chunks, no tool call.
- `single-tool-call`: one complete streamed tool call.
- `multi-tool-call-partial-json`: multiple tool calls with JSON args split across chunks.

Recording pattern:

```ts
const fixture = await recordAiMessageStream(
    "fixture-name",
    "Short description.",
    model.stream(input),
);
```

Replay pattern:

```ts
for await (const chunk of replayAiMessageStream(fixture)) {
    // Feed chunk into parser/runtime under test.
}
```

Fixtures must not include prompt text, note content, API keys, or vault paths unless the test explicitly needs a synthetic path.

## Factories

Use `src/tests/factories` to build registry/tool definitions without copying tool metadata into each test. The default factory registers all current read-only chat tools in stable order.

## Fakes

Use `src/tests/fakes` for provider-level tests. `FakeChatModelProvider` exposes `createChatModel` and `getNativeToolCallingCapability`, and can be cast with `toPaAgentRuntimeAiUtils()` when a test needs to inject the existing `PaAgentRuntime` constructor.
