# PA Agent Runtime Lifecycle Contract

Updated: 2026-09-25

Status: Current canonical lifecycle contract. The long implementation plan and phase evidence are archived at [pa-agent-runtime-lifecycle-plan-implementation-record.md](../archive/pa-agent-runtime-lifecycle-plan-implementation-record.md).

[DEC-040](../product/decisions/dec-040-recoverable-agent-execution.md) and the [B-144 Product Spec](../product/specs/pa-recoverable-agent-execution-product-spec.md) define the recovery, 30-minute attempt, source snapshot, domain delivery and concurrency behavior implemented by B-144. This document is the current technical contract; source and regression tests remain the executable authority.
[DEC-042](../product/decisions/dec-042-agent-task-source-boundary.md) supersedes the ordinary source-declaration protocol and binds Writing to explicit Chat operations.
[DEC-043](../product/decisions/dec-043-agent-runtime-evolution-and-source-scope.md) defines the delivered Chat source selection and runtime evidence boundaries; B-149's scoped local verification and limits are retained in its [validation record](../archive/2026/b149-pa-agent-runtime-evolution-validation.md).

## Run And Turn Model

- One visible user request is one run.
- A run has a 256-turn planning guard; ordinary completion and no-progress policy normally stop much earlier.
- The user message is emitted once, on the first turn.
- Later turns reuse the canonical transcript plus bounded runtime instructions and tool results.
- Chat freezes its conversation's My notes, Web sources, or Combined selection at send time. A change during a run affects only the next request; source withdrawal can still invalidate an affected in-flight input or delivery.
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

Model-facing action history pairs each assistant tool call with its result by
identity. Native and compatibility messages project the same admitted groups,
including original arguments and result status. A missing or ambiguous result
remains explicitly unknown, not inferred from a sibling call. Tool observations
carry their own admitted source lineage, including independently proven
source-free no-match or unavailable results, into the next request.

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

Ordinary note reads do not require `declare_source_scope`, `noteHandles`, or a
model-declared user boundary. The Agent follows natural-language source
instructions; the Host checks actual note identities, Data Boundary, enabled
capabilities, and the complete batch before reading. It rechecks admitted
source snapshots before physical provider requests and final answer delivery.
A Chat source selection also limits exported tools, automatic background,
history, summaries and actual physical request bodies. Complete compatible
input lineage may be projected; mixed or unknown dependencies are withheld.
Displayed prior history remains visible even when the next model request cannot
use it. This selection never enables WebSearch or grants write access.
A rejected batch executes no member. WebSearch also rechecks its live setting
after any detached-request barrier, immediately before the physical send.

The optional `report_task_incomplete` call is pure output for ordinary Chat and
explicit Writing. It must be the only call and contain exactly one nonempty
`answer` string. Invalid arguments or a mixed batch execute no other tools and
receive bounded correction turns under the existing run budget; an accepted
report supplies visible text and an `incomplete` terminal state without creating
a Writing artifact. Tool execution uses native tool-call fields; textual
XML/JSON examples remain ordinary data and never grant execution authority.

## Budgets And Timeouts

| Limit | Default | Enforcement |
| --- | ---: | --- |
| Model turns | 256 | Planning guard; ordinary completion and no-progress policy normally stop earlier. |
| Tool calls | 1,024 | Planning guard; duplicate/recovery policy normally stops earlier. |
| Run wall clock | unbounded | No legacy 180-second forced finalization; an embedding host may explicitly configure a bound. |
| Assistant idle | unbounded | No generic 60-second silence cutoff; user cancellation and the physical-attempt deadline remain active. |
| Model/ordinary remote-tool attempt | 1,800,000 ms | Starts at each physical dispatch/execution and includes full response consumption; a capability may override it. |
| Tool abort grace | 2,000 ms | Late unresolved tool becomes `abort_timeout`; late result is ignored. |
| Loop observations | 64,000 chars | Aggregate prompt observation budget. |
| Chat history | 60,000 chars | Runtime/context projection budget. |
| Read-only tool context | 24,000 chars | Separate bounded context injection layer. |
| Answer input | Verified model window minus verified output reserve and 512-token safety margin; otherwise 120,000 chars | Estimate includes rendered messages and bound schemas; unknown metadata uses the character fallback. |
| Auxiliary summaries per run | 30 physical requests / 60 minutes active wait / 90,000 estimated-or-known reserved tokens | Retries count as physical attempts; optional work stops at the first limit, and irreducible required context fails with an explicit recoverable Context result. |

Changing a default requires runtime, tests, `AGENTS.md`, and current architecture docs to move together.

The dispatcher records the absolute individual-Tool deadline at the same point it
registers the timeout timer and passes that timestamp through the Host-only
execution input. Nested Host work must terminate strictly before that real outer
boundary；it must not restart a fresh clock after schema validation、
scheduling or GC delay. Chat Memory Recovery currently keeps a 250ms Host
settlement margin plus a separate 500ms projection margin inside its own
episode envelope, and classifies projection expiry separately from user
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
- continue with bounded recovery after a retryable provider/tool failure;
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

### Debugging one run

New Chat background excludes Vault Insights whose source receipt is missing or
revoked, without discarding independently valid Personal or awaiting background
refresh. An unchanged aggregate refresh may reuse a still-live receipt; source
epochs, host withdrawal and real content changes still invalidate old input.
At physical dispatch, captured background receipts remain authoritative; the
string comparison fallback applies only when the host supplied no receipt.
Local preparation/admission rejection emits `provider_admission_rejected` and
does not enter SDK retries of the same serialized input. An explicitly classified
history/Vault projection change may use the existing single stream-to-invoke
fallback only when a fresh input preparation callback is available and no output
has arrived. It reprojects fixed read snapshots and rechecks authorization;
background, writing, image,
style and authority rejection cannot use that recovery. Network errors retain
the installed SDK retry policy and recheck admission on each physical attempt.
Every physical start resets only that attempt's deadline; a failed attempt ends
its clock before SDK backoff. Host-level recovery honors a real `Retry-After`
after releasing the per-turn coordinator lease.
The auxiliary limits admit new summary attempts; they do not shorten a request
already dispatched under its 30-minute physical deadline. A run-local usage
ledger distinguishes physical attempts from logical calls, records known
provider usage once per attributable physical response, and leaves missing or
ambiguous usage unknown. It does not infer money from token estimates.

Successful exact duplicate tools reuse their structured result when the
capability says it remains valid. Failed reads may retry; partially succeeded or
acceptance-unknown side effects never replay blindly and instead expose query or
user recovery. Four equivalent provider or candidate failures end as a
no-progress terminal result rather than looping indefinitely.
Continuous same-cause failures form a recovery episode; genuine new evidence
may begin another episode, while full-run turns, tools and physical costs remain
cumulative. Unknown action side effects still require verification before
replay. Normal zero-match, unavailable retrieval and missing evidence for the
requested answer have different completion meanings.

Chat and Pagelet share FIFO lanes but hold a lease for one turn only. History
persists a running placeholder before provider work, overwrites that same turn
with its terminal state, and converts a leftover running record to interrupted
on reload. Continue is always a fresh user action; reload never auto-replays a
provider request or side effect.

Ordinary answer completion requires at least one non-whitespace text character;
the original text is otherwise preserved exactly. Reasoning-only and whitespace-only
streams end incomplete, and only existing bounded observation-based finalization
may retry them. A provider `stop` with whitespace is not a completed answer.
Conflicting finish markers without meaningful text are errors. A `tool_calls`
finish marker without native calls ends incomplete (`provider_tool_calls_missing`)
and withdraws provisional text in both the bridge and canonical Chat UI. Literal
XML under a normal `stop` remains ordinary text; it never grants tool execution.

Native Chat's ordinary text delivery reuses the same Host source receipt as its
preview. Check it before committing text and again after asynchronous Host Policy
at final delivery. Source invalidation withdraws the answer, emits
`assistant_source_changed`, and ends incomplete without reopening tools. Abort/error
statuses retain priority; native writing artifacts and explicit non-text Host
outputs retain their existing contracts. The compatibility bridge emits a
source-changed recovery instead of silently dropping ordinary text. Chat persists
the final run status, so a completed model turn cannot override failed delivery.

With the plugin's existing debug setting enabled, filter the Obsidian developer
console for `PA Agent trace`. These records supplement `PA Agent timing`; they
do not change admission, retry, timeout or completion policy.

- `chat_*` and `chat_lease:*` identify the service request before a runtime exists.
  `chatRequestId` links that request to `runtime_start` and `runId`; lifecycle and preparation
  records then carry `turnId`. HTTP requests made outside a linked Agent model
  explicitly use `runId: null`, `turnId: null`, `stage: unscoped`.
- Preparation records have `:start`, `:end` or `:error`, with durations and known
  host rejection reason codes. `provider_admission` is a local admission check;
  only `http_dispatch` records an actual HTTP dispatch. Repeated admission errors
  without dispatch can expose SDK retries of a local failure.
  `generation_source_rejected` identifies the rejected source group (task,
  writing context, images, style, background or history) without logging its content.
- Each physical HTTP attempt has its own `requestId`; `http_response` records
  response headers for native fetch, or the buffered response for Obsidian
  transport. Neither HTTP 200 nor headers prove a complete answer. Pair them
  with model completion, `message_end`, `turn_end`, and `agent_end`.
  HTTP `elapsedMs` measures the physical attempt; `runElapsedMs` measures time
  since the scoped logger was created. They are distinct clocks.
- Tool records distinguish `policy_rejected`, `preflightOnly` and
  `batchPreflightRejected` from execution. `host_policy` records the reason and
  next tool mode, including transitions to `final_answer_only`.
- Assistant summaries record text length, trimmed text length, thinking length,
  native tool-call identities and a `containsToolCallMarkup` flag. Textual
  `<tool_calls>` is an observation about the body, never permission to execute a
  tool. Only the first message update of each kind is logged, avoiding token-level
  console traffic.

The trace excludes prompt/response bodies, reasoning text, tool arguments,
note content, request headers and credentials. HTTP traces inspect only string
body lengths and message/tool counts; they never consume response streams.
Observer failures are isolated from execution, and disabling debug silences the
trace and skips HTTP body inspection. Enabling debug takes effect for newly
created models; disabling it also silences existing observers. Unknown metadata
reason/outcome codes and exception names are redacted. Existing unrelated debug
messages retain their existing behavior.

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
