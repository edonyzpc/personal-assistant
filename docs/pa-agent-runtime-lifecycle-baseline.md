# PA Agent Runtime Lifecycle Baseline

## Status

| Field | Value |
| --- | --- |
| Status | SPEC-00 baseline artifact |
| Last revised | 2026-05-23 |
| Plan source of truth | [PA Agent Runtime Lifecycle Plan](./pa-agent-runtime-lifecycle-plan.md) |
| Development tracker | [PA Agent Runtime Lifecycle Development Tracker](./pa-agent-runtime-lifecycle-development-tracker.md) |

This document freezes the current PA answer-stream runtime behavior before the canonical lifecycle refactor. It is an implementation baseline, not the target architecture.

## Current Runtime Entry

The PA answer-stream path currently enters through:

- `ChatService.streamLLM(...)`
- `ChatService.shouldUsePaAgentAnswerStream()`
- `ChatAgentRuntime.streamTurn(...)`
- `ChatAgentRuntime.streamPaAgentAnswerTurn(...)`

Current gating:

- `paAgentAnswerStreamEnabled=false` keeps the legacy planning path.
- Ollama stays on the legacy planning path even if the PA runtime setting is enabled.
- Supported PA answer-stream providers use the current in-place runtime path inside `ChatAgentRuntime`.

## Current Event Schema

The current event type is a legacy schema and must be treated as `LegacyAgentEvent` during the canonical migration.

Current base fields:

```ts
interface LegacyAgentEventBase {
  version: 1;
  turnId: string;
  seq: number;
  timestamp: number;
}
```

Current event kinds:

| Kind | Current meaning | Current adapter behavior |
| --- | --- | --- |
| `activity` | Runtime status or timeline activity. | May map to legacy `onStatus` through `detail.legacyStatus`. |
| `answer-started` | First answer text segment started. | No direct legacy callback. |
| `answer-snapshot` | Cumulative visible answer snapshot. | Calls legacy `onChunk(snapshot)`. |
| `reasoning-chunk` | Provider reasoning/thinking text. | Calls legacy `onReasoningChunk(chunk)`. |
| `turn-metadata` | Final turn Memory/source/context metadata. | Calls legacy `onTurnMetadata(metadata)`. |
| `segment-boundary` | Legacy segment transition between thinking, answering, and tool-calling. | No direct legacy callback. |
| `answer-complete` | Legacy normal terminal answer marker. | No direct legacy callback. |
| `partial-output-error` | Error after visible output or non-replayable partial output. | Delivered through `onEvent`; no direct `onChunk`. |
| `aborted` | Runtime abort marker. | Delivered through `onEvent`; abort still rejects. |

Legacy identity limitations:

- Current events have `turnId`, but no `runId`.
- Current events do not distinguish `scope = "run"` from `scope = "turn"`.
- Current `turnId` represents the whole current answer-stream runtime invocation, not canonical internal model-decision turns.
- Current `seq` is monotonic within the legacy emitter instance only.
- Canonical `AgentEvent` must not inherit these limitations.

## Current Event Sequence

The current `ChatAgentRuntime.streamPaAgentAnswerTurn(...)` path has this effective sequence:

| Step | Current event/callback | Current behavior |
| --- | --- | --- |
| 1 | `activity: loop-start` | Emitted when the answer-stream loop starts. |
| 2 | Optional host preparation | Skill context and additional capability providers load before model streaming. |
| 3 | `activity` plus `onStatus({ type: "thinking" })` | Emitted before each model stream turn. |
| 4 | Optional `reasoning-chunk` | Provider reasoning chunks are emitted separately from answer snapshots. |
| 5 | Optional `segment-boundary` to `answering` | First answer delta starts an answer segment. |
| 6 | `answer-started` | Emitted once before the first answer snapshot. |
| 7 | `answer-snapshot` | Emits cumulative `fullResponse`, not deltas. |
| 8 | Optional `segment-boundary` to `tool-calling` | Tool-call delta closes an answering segment if one is open. |
| 9 | Tool execution through `executePlannedToolCall(...)` | Tool execution happens only after the current model stream is consumed and parsed. It does not emit canonical tool lifecycle events. |
| 10 | Optional `segment-boundary` after tool calls | Emits `tool-call-finished` when tool execution finishes. |
| 11 | Repeat model loop | Tool observations feed a later model stream turn until no tool calls remain or budget stops. |
| 12 | `turn-metadata` | Source records and Context Used are emitted near finalization. |
| 13 | `answer-complete` | Current successful terminal marker. |

Current error and abort sequence:

| Current condition | Current event behavior |
| --- | --- |
| Stream fails before visible output | Non-streaming fallback may produce `answer-snapshot`, `turn-metadata`, `answer-complete`. |
| Stream fails after visible answer text | Emits `partial-output-error`, then may emit `turn-metadata` and `answer-complete` for graceful close. |
| Reasoning is visible and stream fails | Emits `reasoning-chunk` and `partial-output-error`; no automatic replay fallback. |
| Provider/tool abort | Emits `aborted` and rejects with abort. |
| Wall-clock cap after visible output | Emits fallback status and `partial-output-error`, then throws deadline error. |

## Current Legacy Callback Contracts

`ChatService` adapts current legacy events to public callbacks.

| Callback | Current contract |
| --- | --- |
| `onChunk(snapshot)` | Receives cumulative answer snapshots from `answer-snapshot`. It is not a provider delta callback. |
| `onReasoningChunk(chunk)` | Receives `reasoning-chunk` for current-session reasoning/thinking display. |
| `onStatus(status)` | Receives legacy `ChatAgentStatus` directly from runtime and through `activity.detail.legacyStatus`. |
| `onTurnMetadata(metadata)` | Receives `turn-metadata`, including source records and Context Used when available. |
| `onEvent(event)` | Receives all current legacy events before callback adaptation. |

Migration contract for callbacks:

- Public `onChunk(snapshot)` remains cumulative and monotonic for legacy consumers.
- In the canonical runtime, `onChunk(snapshot)` must receive committed final text only.
- Optimistic pending text, text reclassification after tool calls, and phase UI should be canonical lifecycle/UI behavior, not legacy callback shrink behavior.
- Legacy `onReasoningChunk`, `onStatus`, and `onTurnMetadata` remain adapter compatibility outputs until ChatView fully consumes canonical lifecycle events.

## Current Test Inventory

Tests currently assert legacy behavior in these areas:

| Area | Current tests |
| --- | --- |
| Legacy terminal marker | `__tests__/pa-agent-answer-stream-runtime.test.ts` asserts `events.at(-1)` is `answer-complete` for direct/fallback answers. `__tests__/chat-service.test.ts` also asserts `answer-complete` ordering in adapter paths. |
| Cumulative snapshots | `__tests__/pa-agent-answer-stream-runtime.test.ts` and `__tests__/chat-service.test.ts` assert ordered `answer-snapshot` arrays such as `"Hello "`, then `"Hello world"`. |
| Segment boundaries | `__tests__/pa-agent-answer-stream-runtime.test.ts` asserts `segment-boundary` reasons like `tool-call-started` and `tool-call-finished`. |
| Reasoning separation | `__tests__/chat-service.test.ts` asserts `reasoning-chunk` and no replay fallback after visible reasoning. `__tests__/chat-view.test.ts` asserts reasoning callback rendering and persistence behavior. |
| Turn metadata and source shape | `__tests__/pa-agent-answer-stream-runtime.test.ts`, `__tests__/chat-service.test.ts`, and `__tests__/chat-view.test.ts` assert `turn-metadata.metadata.sourceRecords` and `contextUsed`. |
| Repeated user message semantics | No direct legacy event test asserts user-message repetition because the current legacy event schema does not emit user messages. Current follow-up model turns rebuild prompt input from the original user prompt plus observations. SPEC-02 must add canonical tests proving the real user message is emitted once in turn #1 and not re-emitted in internal follow-up turns. |
| Rollback/default path | `__tests__/chat-service.test.ts` asserts `paAgentAnswerStreamEnabled=true` uses PA path for supported providers and Ollama stays on legacy planning. |
| Abort/error behavior | `__tests__/pa-agent-answer-stream-runtime.test.ts` and `__tests__/chat-service.test.ts` assert `aborted`, `partial-output-error`, no fallback after visible output, and fallback before visible output. |

Tests that currently assume legacy `answer-complete` or segment semantics must move to adapter or compatibility coverage as canonical lifecycle tests are introduced.

## Allowed Migration Changes

The following legacy assumptions may change inside the canonical PA runtime:

- Canonical runtime terminal event becomes `agent_end`, not `answer-complete`.
- Canonical lifecycle uses `type` with snake_case event names, not legacy `kind`.
- Canonical events add mandatory `runId`, mandatory `turnId`, `scope`, and `version: 2`.
- Canonical `turnId` means an internal model-decision turn, not the entire visible request.
- Tool execution becomes explicit through `tool_execution_start`, `tool_execution_end`, and `toolResult` messages.
- Text emitted before a toolcall in the same assistant message can be reclassified from pending final answer into progress.
- Source records move from final `turn-metadata` ownership to transcript-owned `toolResult.content.sourceRecords`, with derived summaries allowed on turn/agent metadata.

The following compatibility behavior must be preserved during migration:

- `ChatService.streamLLM(...)` remains the public entrypoint.
- Non-PA and disabled-PA paths keep working while canonical runtime is gated.
- Legacy callback consumers receive cumulative committed final snapshots through `onChunk`.
- Legacy history source chips and Context Used still render after ChatView switches to canonical reconstruction.
- Existing source boundary behavior remains intact: Memory sources stay Memory-only, current-note context stays current-note/tool context, and WebSearch sources stay Web-only.

## Default Path And Rollback Contract

Before the canonical loop becomes the default PA path:

- SPEC-05 must prove Memory, current-note, Builtin WebSearch, source chips, and Context Used parity.
- SPEC-06 must prove ChatView lifecycle rendering does not duplicate text and can restore composer state.
- SPEC-08 must provide automated checks plus Obsidian test vault smoke evidence.

Rollback expectations:

- `paAgentAnswerStreamEnabled=false` must continue to route through the legacy planning path until explicit closeout removes the flag.
- Declined or unvalidated providers, including Ollama, must continue to use the legacy planning path.
- Canonical runtime can be internal/test-only until parity gates pass.

## Persisted History Compatibility

Current chat history can contain legacy turn metadata:

- `ChatTurnMemoryMetadata.sourceRecords`
- `ChatTurnMemoryMetadata.contextUsed`
- legacy source/context structures rendered by ChatView

Canonical history must dual-read old and new shapes:

- New canonical turns should carry a schema version.
- New source chips should be reconstructable from transcript `toolResult` messages plus diagnostics.
- Old history must still render source chips and Context Used without rewriting or deleting existing entries.
