# PA Agent Runtime Lifecycle Contract

Updated: 2026-08-28

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
| Assistant idle | 60,000 ms | Incremental delivery with no stream activity produces `idle_timeout`; buffered delivery relies on the absolute wall clock. |
| Individual tool timeout | 30,000 ms | Default recoverable tool outcome. |
| Tool abort grace | 2,000 ms | Late unresolved tool becomes `abort_timeout`; late result is ignored. |
| Loop observations | 64,000 chars | Aggregate prompt observation budget. |
| Chat history | 60,000 chars | Runtime/context projection budget. |
| Read-only tool context | 24,000 chars | Separate bounded context injection layer. |

Changing a default requires runtime, tests, `AGENTS.md`, and current architecture docs to move together.

The dispatcher records the absolute individual-Tool deadline at the same point it
registers the timeout timer and passes that timestamp through the Host-only
execution input. Nested Host work must terminate strictly before that real outer
boundary；it must not restart a fresh 30-second clock after schema validation、
scheduling or GC delay. Chat Memory Recovery currently keeps a 250ms Host
settlement margin plus a separate 500ms projection margin inside the unchanged
30,000ms Tool envelope, and classifies projection expiry separately from user
abort while discarding late results.

## Provider Transport

- `native` and `obsidian` are requested network bridges, not different tool-calling protocols.
  Both still use the OpenAI-compatible Chat model contract.
- Desktop keeps requested `native` streaming. Explicit `obsidian` requests keep using
  `obsidianFetch` / Obsidian `requestUrl`.
- On the iOS app, a requested `native` call to a known DashScope-compatible base URL is
  resolved centrally to `obsidianFetch`. Real-device isolation showed that WKWebView
  `global fetch` could leave both ChatOpenAI streaming and non-streaming body completion
  unresolved even after the Network panel had received the response, while the same
  calls completed through `requestUrl`.
- The iOS compatibility rule lives at `AIUtils` client construction, so Chat, Memory
  query rewrite/rerank, and Pagelet receive the same effective bridge. It does not
  broaden to Android, OpenAI, or arbitrary custom endpoints without matching evidence.
- `requestUrl` buffers the response. Abort rejects the local call and late results are
  ignored, but the underlying native request may still finish remotely; no physical
  network-cancel claim is made.
- Every Chat or Pagelet Agent Run owns one `ProviderRequestScope`. Capability
  classification、Memory query rewrite/rerank/query embedding、Builtin WebSearch MCP
  traffic and the main model share that scope. Every WebSearch initialize、initialized、
  tools-list and tools-call POST reaches `obsidianFetch` with the exact run-owned scope.
  Its local timeout or external abort cancels a child request signal without mutating the
  outer run signal, so a still-running raw `requestUrl` promise becomes the same drain
  barrier as any other locally detached Provider request. If such a call is still
  physically running, the scope waits for its raw promise to settle before admitting a
  later Provider dispatch.
  The final barrier check、deadline admission hook and `requestUrl` construction run in
  one synchronous segment. The Pagelet production model factory must forward the exact
  run-owned scope and physical-dispatch hook supplied by its Loop；static model/transport
  settings must not drop or replace them. Ordinary in-flight rewrite + embedding work
  remains concurrent；only detached requests form a barrier.
- A buffered response has no observable inter-chunk activity, so the incremental
  assistant-idle timer does not apply. The absolute turn wall clock remains the
  authoritative deadline.
- Buffered delivery keeps the configured non-zero finalization reserve. Before every
  physical dispatch, the Loop atomically rejects new ordinary requests at `softAt`.
  A buffered request that was already dispatched before `softAt` may finish only until
  `hardAt`; it cannot continue to tools、fallback invoke or another turn. Completion
  after `softAt` is returned as `completed_with_warning` with
  `finalization_reserve_overrun`, and performance evidence must count it as a deadline
  rather than PASS. Reaching `hardAt` remains fail-closed `incomplete`.
- The drain barrier is deliberately run-scoped. A detached request from a cancelled
  earlier run does not globally stall an unrelated new run；cross-run overlap is a
  documented residual that would require a separate global-concurrency decision.
- Model adapters drain the complete finite ChatOpenAI result, including usage emitted
  after `finish_reason`. A high-level `finish_reason` shortcut must not replace the
  transport rule.

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
- Memory readiness callers race shared/non-cancellable local probes so abort
  detaches immediately without opening a late approval or preparation. Chat-owned
  fast verification receives a linked controller and suppresses every late status、
  flush or retry side effect. Approval modals settle/close once and late clicks are
  inert.
- A blocking approved Memory preparation follows the Tool attempt signal. The
  DEC-028 first-use background preparation instead follows a distinct Host-only
  Chat/Pagelet run-owner signal：normal Tool completion does not cancel it, while
  user abort/supersede does. Normal per-turn Chat runtime disposal follows every
  completed answer and therefore does not abort the transferred preparation；
  plugin unload/Memory shutdown cancels it through `MemoryManager`. Once a command/
  shared caller joins the same preparation, one run-owner abort cannot kill the
  shared work. Runtime signal composition does not require `AbortSignal.any`, so
  this path remains valid on the declared older-iOS WebKit floor.
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
