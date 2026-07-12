# PA Agent Runtime Lifecycle Contract

Updated: 2026-07-11

Status: Current canonical lifecycle contract. The long implementation plan and phase evidence are archived at [pa-agent-runtime-lifecycle-plan-implementation-record.md](../archive/pa-agent-runtime-lifecycle-plan-implementation-record.md).

## Run And Turn Model

- One visible user request is one run.
- A run may contain up to 20 internal model turns.
- The user message is emitted once, on the first turn.
- Later turns reuse the canonical transcript plus bounded runtime instructions and tool results.
- Run-scope events use `turnId = RUN_SCOPE_TURN_ID` (`"__run__"`).
- `agent_end.metadata.finalTurnId` records the final real turn id.

## Canonical Event Sequence

```mermaid
sequenceDiagram
  participant UI as ChatView
  participant Runtime as PaAgentRuntime
  participant Loop as PaAgentLoop
  participant Model as Model stream
  participant Tools as Tool dispatcher

  Runtime->>Loop: run(user input, context, policy)
  Loop-->>UI: agent_start
  loop model turn
    Loop-->>UI: turn_start
    Loop-->>UI: message_start(user on first turn)
    Loop-->>UI: message_end(user on first turn)
    Loop->>Model: stream canonical transcript
    Loop-->>UI: message_start(assistant)
    Model-->>Loop: thinking/text/tool-call deltas
    Loop-->>UI: message_update*
    Loop-->>UI: message_end(assistant)
    opt tool calls
      Loop->>Tools: execute buffered calls
      Tools-->>UI: tool_execution_start/update/end
      Tools-->>UI: message_start/end(toolResult)
    end
    Loop-->>UI: turn_end
  end
  Loop-->>UI: agent_end
```

Canonical event types are:

```text
agent_start
turn_start
message_start
message_update
message_end
tool_execution_start
tool_execution_update
tool_execution_end
turn_end
agent_end
```

## Identity Invariants

Every `AgentEvent` carries:

- `version: 2`
- `runId`
- `turnId`
- `scope: run | turn`
- gapless run-level `seq`
- `timestamp`
- event `type`

Rules:

- Identity is attached and validated before dispatch.
- `seq` never resets per turn.
- Consumers do not infer run/turn identity from array order, message id, tool id, or legacy status.
- `agent_end` is terminal; no later event may be emitted.
- Tool execution always has paired start/end events, including policy rejection, schema failure, abort, timeout, or duplicate skip.

## Message Model

Canonical transcript messages are:

- `user`: original content and timestamp;
- `assistant`: ordered thinking, text, and toolCall parts plus stop reason;
- `toolResult`: tool call identity, bounded prompt/preview content, error state, sources, Context Used, and safe metadata.

`message_update` distinguishes thinking/text/toolcall start, delta, and end. Thinking and provisional assistant text are progress, not committed final answer text.

The final visible answer is derived only from committed final text. When a streamed assistant message transitions into tool calls, pending text may be reclassified as thinking and must not be persisted as final answer content.

## Tool Dispatch

Production runtime opts into hybrid dispatch:

- independent read-only/idempotent calls may run concurrently;
- a call whose capability requires sequential execution forces the batch to sequential mode;
- action/write calls must never be parallelized merely because neighboring calls are read-only;
- the dispatcher preserves model call order in emitted result messages;
- duplicate calls can be skipped with explicit `duplicate_skipped` outcome.

Tool input flow:

```text
buffered call → parse → registry prepareAndValidate → policy gate
→ timeout/abort-aware execute → structured toolResult → host policy
```

Supported outcomes:

```text
success
recoverable_error
schema_invalid
policy_rejected
budget_exceeded
duplicate_skipped
aborted
abort_timeout
```

## Budgets And Timeouts

| Limit | Default | Enforcement |
| --- | ---: | --- |
| Model turns | 20 | `PaAgentLoop` stops before starting another turn. |
| Tool calls | 30 | `ToolExecutionDispatcher` returns budget outcome. |
| Run wall clock | 180,000 ms | Checked before/within turns and tool dispatch. |
| Assistant idle | 60,000 ms | No stream activity produces `idle_timeout`. |
| Individual tool timeout | 30,000 ms | Default recoverable tool outcome. |
| Tool abort grace | 2,000 ms | Late unresolved tool becomes `abort_timeout`; late result is ignored. |
| Loop observations | 64,000 chars | Aggregate prompt observation budget. |
| Chat history | 60,000 chars | Runtime/context projection budget. |
| Read-only tool context | 24,000 chars | Separate bounded context injection layer. |

Changing a default requires runtime, tests, `AGENTS.md`, and current architecture docs to move together.

## Host Policy

`PaAgentLoop` owns ordering and hard cleanup. Host policy owns product-specific continuation.

After each turn, host policy can:

- stop with completed/completed-with-warning/incomplete state;
- continue with a corrective runtime instruction;
- require a specific capability result;
- retry a failed required tool once;
- force a final-answer-only turn;
- surface structured diagnostics/warnings;
- stop when evidence, budget, or safety conditions are not satisfied.

Required capabilities are satisfied by successful tool results, not by the model merely emitting a tool call.

## Cancellation And Failure

- User abort propagates through model and tool paths.
- Tools get a bounded grace period; a provider request that cannot be hard-cancelled may finish remotely, but its late result cannot update the run.
- Wall-clock and idle termination emit structured diagnostics.
- Provider/runtime exceptions produce terminal `agent_end` error state and retain safe diagnostic payloads for upstream logs.
- Partial/pending assistant text is not promoted to a successful final answer after error or abort.

## UI And History

- `ChatView` consumes `onLifecycleEvent` as the live canonical lane.
- `CanonicalToLegacyEventAdapter` exists for compatibility callbacks only.
- A canonical live turn must not also render legacy callbacks.
- History persists `PaAgentPersistedTurn` records and source/context metadata.
- Reopen/dual-read compatibility may read older metadata, but new writes use the canonical schema.
- Warnings are rendered from structured runtime metadata rather than injected into answer text.

## Completion Status

`agent_end.status` is one of:

```text
completed
completed_with_warning
incomplete
aborted
error
```

The status must match committed text, required-capability evidence, warnings, cancellation, and errors. A non-empty draft is not sufficient to declare `completed`.

## Regression Checklist

Lifecycle changes must verify:

- gapless event identity and terminal ordering;
- direct answer, thinking, tool call, multi-turn corrective, and final-answer-only paths;
- paired tool events for success and every failure outcome;
- cancellation, idle, wall-clock, tool timeout, and late-result discard;
- hybrid read-only dispatch and sequential action protection;
- committed-only final text and no duplicate canonical/legacy rendering;
- canonical persistence/reopen plus legacy dual-read;
- source/Context Used reconstruction and warning metadata;
- focused tests, typecheck, then real Obsidian smoke for visible runtime changes.

## Related Docs

- [PA Agent Current Architecture](./pa-agent-architecture-plan.md)
- [Context limits and module map](../../AGENTS.md)
- [Operations Agent proposal](../development/proposals/operations-agent/operations-agent-plan.md)
- [Historical lifecycle implementation record](../archive/pa-agent-runtime-lifecycle-plan-implementation-record.md)
