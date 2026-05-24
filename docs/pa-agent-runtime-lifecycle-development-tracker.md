# PA Agent Runtime Lifecycle Development Tracker

## Status

| Field | Value |
| --- | --- |
| Track | PA Agent canonical lifecycle runtime refactor |
| Current status | Final lifecycle decisions are documented and optimized around the canonical audit/query identity contract, including future storage/query helper expectations for `runId + turnId + seq`. SPEC-01 through SPEC-08 are done. Recorded smoke evidence: direct answer, current-note tool, Memory, builtin WebSearch, unsupported warning, all 7 bundled-skill prompts, cancel/recovery, and direct DevTools console no-error inspection. |
| Last revised | 2026-05-24 |
| Plan source of truth | [PA Agent Runtime Lifecycle Plan](./pa-agent-runtime-lifecycle-plan.md) |
| Parent tracker | [PA Agent Development Tracker](./pa-agent-development-tracker.md) |
| Current runtime baseline | The baseline artifact records the pre-refactor PA answer-stream path in `ChatAgentRuntime.streamPaAgentAnswerTurn(...)`. Current SPEC-06 behavior routes PA-aware ChatView requests through canonical lifecycle events when `onLifecycleEvent` is present, while no-lifecycle consumers keep the compatibility path. |

This tracker is for the canonical lifecycle runtime refactor only. Product and architecture decisions live in the plan. Do not mark a SPEC `[A] Approved` until its acceptance criteria, tests, and migration behavior are explicit.

## Current Closeout Snapshot

| Area | State |
| --- | --- |
| Canonical identity decision | Finalized: every canonical event carries mandatory raw `runId + turnId`; run-level events use `RUN_SCOPE_TURN_ID`; progress/update events are not exempt; `seq` is run-level gapless ordering and completes the exact event record key as `runId + turnId + seq`. |
| Event identity implementation guard | Finalized: no UI/history/diagnostic/adapter path may receive lifecycle progress before the canonical emitter attaches and validates `runId`, `turnId`, `scope`, `seq`, and `timestamp`. |
| Runtime architecture decision | Finalized: `PaAgentLoop` owns lifecycle ordering and hard cleanup; `HostPolicy` owns PA product decisions and returns after-turn decisions. |
| Prompt/cache decision | Finalized: dynamic runtime instructions are appended after user input and do not mutate the stable system prompt prefix. |
| WebSearch boundary | Finalized: provider web fallback is removed; only builtin `webSearch` may perform web search and create web source records. |
| Remaining closeout | None for this lifecycle tracker. Normal release readiness remains covered by the repository release workflow. |

## Status Legend

| Status | Meaning |
| --- | --- |
| `[D]` Draft | Scope captured but not ready for implementation. |
| `[R]` Ready for review | Acceptance criteria are written; awaiting review. |
| `[A]` Approved for implementation | Reviewed and ready for code changes. |
| `[~]` In progress | Implementation started. |
| `[!]` Blocked | Waiting on a decision, dependency, or failed gate. |
| `[x]` Done | Code, tests, docs, and required smoke evidence are complete or explicitly deferred. |

## SPEC Index

| SPEC | Goal | Status | Depends On | Primary Areas | Exit Gate |
| --- | --- | --- | --- | --- | --- |
| SPEC-00 | Baseline and migration contract | `[x]` Done | None | Docs, current tests, runtime inventory | Current PA event/callback contracts and allowed breakage are documented. |
| SPEC-01 | Canonical event, message, status, and emitter types | `[x]` Done | SPEC-00 | `chat-types`, runtime primitives, tests | Canonical `AgentEvent`, `LegacyAgentEvent`, messages, statuses, and terminal rules compile and pass focused tests. |
| SPEC-02 | PaAgentLoop direct-answer extraction and HostPolicy shell | `[x]` Done | SPEC-01 | `pa-agent-loop`, `chat-agent` host | Direct answer, one user message per run, optimistic final streaming, adapter snapshots, and after-turn decisions pass tests. |
| SPEC-03 | Idle, provider error, abort, and run budgets | `[x]` Done | SPEC-02 | stream supervisor, deadline, budget tests | Thinking/text/toolcall deltas reset idle; abort/error/budget paths converge to `turn_end -> agent_end`. |
| SPEC-04 | Tool-call barrier and structured toolResult messages | `[x]` Done | SPEC-02, SPEC-03 | tool parsing, tool executor boundary, transcript | Tool calls execute only after assistant message end; sequential tool execution and all tool outcomes emit paired events and toolResult messages. |
| SPEC-05 | Memory/current-note/WebSearch host integration and source ownership | `[x]` Done | SPEC-04 | core tools, builtin WebSearch, source metadata | Memory/current note/WebSearch use canonical loop without hidden context, source-boundary regressions, or provider search fallback. |
| SPEC-06 | Legacy adapter and ChatView lifecycle UI | `[x]` Done | SPEC-02, SPEC-05 | `chat-agent`, `chat-service`, `chat-view`, history helpers, UI tests | PA path consumes lifecycle events; legacy callbacks do not duplicate rendering; warnings are UI metadata, not answer body text. |
| SPEC-07 | Required-capability HostPolicy and classifier | `[x]` Done | SPEC-02, SPEC-05, SPEC-06 | policy model, fallback rules, diagnostics, metadata | Required/suggested capability classification, first-turn instructions, one corrective turn, unavailable notes, and warning metadata pass tests. |
| SPEC-08 | Closeout verification and smoke | `[x]` Done | SPEC-01 to SPEC-07 | full tests, deploy, Obsidian smoke | Automated checks and test vault smoke close the runtime lifecycle gates. |

## Confirmed Decision Coverage

The linked plan now records the confirmed lifecycle decisions from the discussion:

- Canonical runtime event type is `AgentEvent`; old events become `LegacyAgentEvent`.
- All canonical events carry the raw `runId + turnId` id marker; run-level events use `turnId = RUN_SCOPE_TURN_ID` with `scope = "run"`.
- `runId` and `turnId` are mandatory for every canonical event, not optional compatibility fields.
- Progress/update events are first-class canonical events. `message_update`, `tool_execution_update`, thinking/text/toolcall deltas, and tool progress must carry the same identity fields as start/end events.
- Every canonical event is self-contained for audit/query: consumers read `runId`, `turnId`, `scope`, and `seq` from that event record, not from surrounding stream context.
- No standalone `eventId` field is required in this refactor; canonical identity data is stored as structured fields on the event.
- When product docs, code comments, or tests refer to an event id marker, they mean the raw `runId + turnId` pair carried on the canonical event.
- `runId + turnId` is the audit/query scope key, not a unique row id by itself. `seq` is mandatory because `runId + turnId + seq` is the exact event record key.
- `seq` is gapless and monotonic across the whole run; it does not reset per turn.
- The SDD review question about making `turnId` optional is resolved by product decision: do not make it optional. All events need an id marker for audit/query, so run-level events use `RUN_SCOPE_TURN_ID`.
- Event identity is stored as raw structured fields first. Encoded keys are helper artifacts only, so future audit/query code can filter by `runId`, group by `runId + turnId`, and locate exact records by `runId + turnId + seq`.
- Use `runId` and `turnId` as the implementation spelling in specs, types, tests, history metadata, and audit helpers. Do not introduce parallel `runID`/`turnID` field names.
- Encoded helper keys are allowed for storage/logs, but implementation must preserve raw `runId`, `turnId`, `scope`, and `seq` fields and avoid unsafe raw-string concatenation.
- `agent_start` and `agent_end` are not run-only exceptions; they keep the same common key shape through `turnId = RUN_SCOPE_TURN_ID`.
- `agent_end.metadata.finalTurnId` may reference the last actual model-decision turn, but `agent_end.turnId` remains the run-scope marker for audit grouping.
- Run-scope and turn-scope event construction should go through separate helpers so `RUN_SCOPE_TURN_ID` cannot leak into real turns and real turn ids cannot leak into run-scope events.
- Helper keys such as `auditScopeKey` and `eventRecordKey` are derived from delimiter-safe encoding of raw fields. They are not replacement identities and must not be the only persisted event identity.
- Emitter validation must reject scope mismatches: run-scope events without `RUN_SCOPE_TURN_ID`, and turn-scope events that use the reserved run-scope id.
- Message ids, tool call ids, and tool execution ids are secondary relationship ids; they do not replace `runId + turnId` event scope identity.
- `PaAgentLoop` is the runtime state machine; `ChatAgentRuntime` is host and dependency provider.
- `AgentRun` is one visible user request to `agent_end`; a turn is one model decision loop.
- The real user message is emitted only once; internal follow-up turns do not repeat user messages.
- Assistant text is optimistic pending final text until assistant message end; if a toolcall appears, it is reclassified into progress.
- Tool execution starts only after `message_end: assistant`.
- V1 tool execution is sequential and best-effort.
- Every tool outcome emits `tool_execution_end` and a structured `toolResult` message.
- ToolResult source records are canonical on `toolResult.content.sourceRecords`.
- Context Used is aggregated from toolResult content and turn diagnostics.
- SkillContext is host pre-context, not fake toolResult.
- Memory and current-note content enter only through tools.
- Run budgets are `maxTurns=20`, `maxToolCalls=30`, `maxWallClockMs=180000`, and `maxObservationChars=24000`.
- Provider web search fallback is removed from code, settings, UI, and tests; web search is owned only by the builtin `webSearch` tool.
- Required capability detection belongs to HostPolicy and uses a lightweight classifier with deterministic fallback.
- Classifier timeout is 800ms; policy model is dedicated and optional.
- Required instructions and unavailable notes are appended after user input, not injected into dynamic system prompts.
- Required capabilities are satisfied only by successful matching `toolResult` messages, not by assistant toolcall intent or failed/error tool results.
- Required capability missing can produce `completed_with_warning` with UI metadata; it does not pollute answer body text.
- Required capability missing with no usable answer produces `incomplete` diagnostic metadata; internal no-tool failure text is not appended to the assistant answer body.
- After successful tool observations are gathered, an `assistant_empty_response` follow-up may trigger one transient runtime-instruction retry; a second empty response stops with `incomplete`.
- Canonical host-tool execution tolerates benign `get_current_note_context` mode drift from providers by normalizing aliases such as `nearby` to `selection-or-nearby` before executing the same read-only tool.
- Canonical host-tool execution tolerates benign `search_memory` argument drift after the model explicitly selects the Memory tool. Query aliases normalize to `{ query }`; if arguments are missing or empty, the original user request may be used as the read-only Memory query. This does not reintroduce hidden Memory pre-context.
- Canonical host-tool execution tolerates benign builtin `webSearch` argument drift after the model explicitly selects the builtin tool. Query aliases normalize to `{ query }`; if arguments are missing or empty, the original user request may be used as the read-only builtin query. This is not provider web fallback.
- Deterministic WebSearch fallback no longer treats `current note` wording as web freshness; WebSearch requires explicit web/freshness phrasing such as "search the web", "latest", "today", "current news", or "current price".
- Legacy `onChunk(snapshot)` receives committed final text only; optimistic pending streaming is canonical UI behavior.
- Lifecycle closeout is gated until Memory/current-note/WebSearch, source chips, Context Used, UI parity, and Obsidian smoke pass.

## Decision Traceability Matrix

| Decision area | Plan section | Owner SPEC | Verification shape |
| --- | --- | --- | --- |
| Canonical event identity and audit ids | Event Model And Audit Identity | SPEC-01 | Event contract tests for self-contained event identity, mandatory `runId + turnId` id markers, mandatory `scope`, reserved run-scope turn id, `scope`/`turnId` validation, no standalone primary `eventId`, `agent_end.metadata.finalTurnId` separation, event-type identity matrix, delimiter-safe exact event key derivation as `runId + turnId + seq`, timestamps, and final `agent_end`. |
| Run/turn/user message semantics | Run And Turn Semantics | SPEC-02 | Direct and follow-up turn tests; one real user message per run. |
| Optimistic text reclassification | Assistant Text, Toolcalls, And Final Answer Streaming | SPEC-02, SPEC-06 | Runtime pending/commit/reclassify tests plus UI rendering tests. |
| Migration gating and rollback | Migration Gates | SPEC-00, SPEC-08 | Baseline artifact, internal/test flag evidence, deploy and smoke parity gates. |
| Loop/HostPolicy separation | Architecture Shape; Loop And HostPolicy Ownership; HostPolicy And After-Turn Decisions | SPEC-02, SPEC-07 | Loop tests assert paired lifecycle cleanup and HostPolicy-after-`turn_end`; policy tests own continue/stop/warning/runtime-instruction behavior. |
| HostPolicy after-turn decisions | HostPolicy And After-Turn Decisions | SPEC-02, SPEC-07 | Continue/stop unit tests and required-capability policy tests. |
| Status models | Status Models | SPEC-01, SPEC-03, SPEC-04, SPEC-07 | Status enum tests plus idle/error/tool/warning path tests. |
| Run budgets | Run-Level Budgets | SPEC-03, SPEC-04 | Boundary tests for turns/tools/wall-clock/observation truncation. |
| Idle/provider error/abort | Timeout, Idle, Provider Error, And Abort | SPEC-03, SPEC-04 | Fake-timer stream/tool tests and late-result discard tests. |
| Tool execution and toolResult contract | Tool Execution | SPEC-04 | Table-driven tool outcome tests. |
| SourceRecords and Context Used ownership | Source Records And Context Used | SPEC-05, SPEC-06 | Source/context metadata tests plus history dual-read tests. |
| Provider web fallback removal | Builtin WebSearch Only And Provider Fallback Removal | SPEC-05, SPEC-07 | Provider request, settings/defaults, settings UI, tests, source metadata, and status-record checks prove only builtin `webSearch` performs web search. |
| Prompt serialization and cache stability | Prompt And Tool Metadata Policy | SPEC-07 | Provider-request snapshot tests. |
| Required capability policy/classifier | Required Capability Policy; Required Capability Classifier | SPEC-07 | Classifier, fallback, multi-capability, corrective, unavailable, and warning metadata tests. |
| Legacy adapter compatibility | Legacy Adapter | SPEC-02, SPEC-06 | Committed-only monotonic `onChunk` and callback compatibility tests. |
| Chat UI and smoke behavior | Chat UI Behavior; Verification Baseline | SPEC-06, SPEC-08 | Canonical `onLifecycleEvent` UI reducer tests, history redraw tests, and Obsidian smoke test cards. |

## Latest Discussion Resolution

| Topic | Final resolution | Tracker impact |
| --- | --- | --- |
| Event id marker | Every canonical event carries raw `runId + turnId` on the event record. This pair is the audit/query id marker for later inspection, while `seq` makes one event record unique inside that scope. | SPEC-01 acceptance and verification must reject missing/empty `runId` or `turnId` for every canonical event and assert exact lookup by `runId + turnId + seq`. |
| Audit/query layering | `runId` groups one visible user request; `runId + turnId` is the mandatory event id marker / audit scope; `runId + turnId + seq` is the exact event record key. | Tests and future storage/query helpers must preserve all raw fields and may only derive encoded helper keys from them. |
| Run-level lifecycle events | `agent_start` and `agent_end` are not exceptions. They use `scope = "run"` and `turnId = RUN_SCOPE_TURN_ID`. | Tests must prove run-level events can be queried by `runId + RUN_SCOPE_TURN_ID`; `agent_end.metadata.finalTurnId` is only a relationship reference. |
| SDD finding on optional `turnId` | Rejected by product decision. All events need an id marker for audit/query, so `turnId` stays mandatory and run-level events use the reserved run-scope id. | Keep `turnId` mandatory in types, emitter validation, adapter assumptions, history records, and audit helper tests. |
| Emitter scope validation | A run-scope event must use `RUN_SCOPE_TURN_ID`; a turn-scope event must use an actual turn id. | Emitter/helpers must reject mismatched scope and turn id combinations so audit queries cannot receive ambiguous records. |
| Progress/update event identity | Thinking/text/toolcall deltas and tool progress are not identity-free UI events. | `message_update` and `tool_execution_update` tests must assert complete `runId`, `turnId`, `scope`, `seq`, and `timestamp` fields before UI/history/adapter dispatch. |
| Pre-canonical progress | Rejected. UI, history, diagnostics, and legacy adapters must observe canonical events after identity validation, not raw progress later decorated with ids. | Emitter tests and UI reducer tests should fail if progress/update events are missing identity or bypass canonical dispatch. |
| Exact event lookup | `seq` is mandatory and gapless inside a run, and it does not reset on `turn_start`. It narrows `runId + turnId` to one exact record, but does not replace the event id marker. | Tests should derive exact keys from raw `runId`, `turnId`, and `seq`; encoded keys are helper artifacts only. |
| Field naming | Specs and implementation use `runId` / `turnId` consistently. `runID` / `turnID` may appear in conversation but must not become separate persisted fields. | Types, tests, history metadata, and audit helpers must use one field spelling so queries do not split across aliases. |
| Identity helper boundaries | `auditScopeKey` and `eventRecordKey` may exist for logs/storage, but raw `runId`, `turnId`, `scope`, and `seq` remain canonical fields on every event. | SPEC-01 tests and docs must reject helper-key-only persistence or unsafe raw-string concatenation. |
| Future audit/query helper contract | Query helpers should accept structured inputs: `{ runId }`, `{ runId, turnId }`, or `{ runId, turnId, seq }`. They may derive encoded helper keys internally but must not require callers to pass concatenated strings. | Future persistence/query work must keep `listRunEvents`, `listScopeEvents`, `getEventRecord`, and run timeline grouping aligned with the plan's identity contract. |
| Rejected identity shapes | Optional `turnId`, standalone-only `eventId`, per-turn `seq` reset, relationship-id replacement, and helper-key-only persistence are rejected for this refactor. | Review future event/history changes against these rejected shapes before accepting implementation shortcuts. |
| User interaction shape | One user input creates one `AgentRun`; internal turns continue until HostPolicy/model state says final answer, warning, incomplete, abort, or error. | SPEC-02/SPEC-07 tests must preserve one emitted user message and follow-up turns without repeated user messages. |
| Loop/HostPolicy boundary | Keep `PaAgentLoop` as lifecycle machine and `HostPolicy` as PA business policy even if implementation files are adjacent. | SPEC-02/SPEC-07 must keep lifecycle event emission in the loop and policy decisions as returned after-turn decisions, not competing event emitters. |
| Prompt cache stability | Dynamic policy notes are appended after user input in a transient runtime envelope, not inserted by changing the stable system prompt. | SPEC-07 prompt snapshots must prove the system prompt prefix is unchanged. |
| Warning UX | Missing/unused required capability state is rendered as structured UI metadata, not appended to answer body. | SPEC-06/SPEC-07 tests must check no answer-body diagnostic copy. |
| Web search boundary | Provider web fallback remains removed; only builtin `webSearch` may create web source records. | SPEC-05/SPEC-07 checks must keep provider request/settings/UI/tests free of provider web search behavior. |

## SPEC-00: Baseline And Migration Contract

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Freeze the current runtime behavior and explicitly list which legacy assumptions may be changed. |
| Owner docs | `docs/pa-agent-runtime-lifecycle-baseline.md`, `docs/pa-agent-runtime-lifecycle-plan.md`, this tracker |
| Out of scope | Runtime code changes. |

Acceptance checklist:

- [x] Baseline artifact contains a current event sequence table for `ChatAgentRuntime.streamPaAgentAnswerTurn(...)`.
- [x] Baseline artifact lists legacy callback contracts: `onChunk`, `onReasoningChunk`, `onStatus`, `onTurnMetadata`, `onEvent`.
- [x] Baseline artifact inventories tests that assume legacy `answer-complete` terminal behavior, repeated user message semantics, cumulative snapshots, segment boundaries, or source metadata shape.
- [x] Baseline artifact documents legacy `onChunk` committed-only monotonic semantics for canonical adapter output.
- [x] Baseline artifact separates legacy callback compatibility requirements from canonical PA runtime event requirements.
- [x] Baseline artifact documents the original default-path preservation rule and rollback expectations before SPEC-06 canonical ChatView routing.
- [x] Rollback path expectations for non-PA providers and `paAgentAnswerStreamEnabled=false` are documented.
- [x] Migration allowances for renaming current `AgentEvent` to `LegacyAgentEvent` are documented.
- [x] Baseline artifact documents that legacy events may lack canonical event identity and must be adapted without weakening canonical `AgentEvent` invariants.
- [x] Persisted chat history compatibility requirements are documented, including legacy source/context metadata dual-read.

## SPEC-01: Canonical Event, Message, Status, And Emitter Types

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Add canonical lifecycle event, message, assistant update, status, toolResult, and emitter types. |
| Primary files | `src/ai-services/chat-types.ts`, `src/ai-services/agent-runtime-primitives.ts`, focused tests |
| Out of scope | Runtime loop behavior changes. |

Acceptance checklist:

- [x] Canonical `AgentEvent` has `version: 2`, `runId`, `turnId`, `seq`, `timestamp`, and snake_case `type`.
- [x] `runId` and `turnId` are required non-empty strings for all canonical events, not optional or nullable fields.
- [x] Canonical `AgentEvent` has `scope: "run" | "turn"`.
- [x] `agent_start` and `agent_end` use centralized `RUN_SCOPE_TURN_ID = "__run__"` and `scope = "run"`.
- [x] turn/message/tool events use actual turn ids and `scope = "turn"`.
- [x] Canonical events are self-contained for audit/query and never require consumers to infer `runId` or `turnId` from stream position, message ids, tool call ids, tool execution ids, or legacy status order.
- [x] Progress/update events such as `message_update` and `tool_execution_update` carry the same required identity fields as lifecycle start/end events.
- [x] UI/history/diagnostic/adapter consumers receive lifecycle progress only after canonical emitter validation; there are no identity-free or later-decorated progress records.
- [x] Event type identity matrix is documented for agent, turn, message, and tool execution events.
- [x] Canonical events do not require a separate `eventId`; audit/query scope is the raw `runId + turnId` pair, and exact event lookup adds `seq`.
- [x] `runId + turnId` is documented as a query scope marker, not a unique event-row id by itself; the exact event record key is `runId + turnId + seq`.
- [x] Event identity terminology is standardized: "event id marker" means the structured `runId + turnId` pair, not a separate opaque `eventId`; `seq` is the required exact-record discriminator inside that pair.
- [x] `agent_end.turnId` remains `RUN_SCOPE_TURN_ID`; the last actual turn id is represented only as metadata such as `finalTurnId`.
- [x] Event construction helpers validate `scope`/`turnId` consistency: run-scope events require `RUN_SCOPE_TURN_ID`, and turn-scope events require an actual turn id.
- [x] Event construction helpers reject missing/empty `runId` or `turnId`, including run-level events that forget the reserved run-scope turn id.
- [x] Event stream tests assert `runId + turnId` audit/query grouping and `runId + turnId + seq` exact event key derivation.
- [x] Audit helper tests keep raw structured fields as canonical identity and treat encoded keys as delimiter-safe helper artifacts only.
- [x] Event stream tests assert `seq` is run-level gapless ordering and does not reset for follow-up turns.
- [x] Run-scope construction and turn-scope construction are separated enough that `RUN_SCOPE_TURN_ID` cannot be accidentally used for a real turn.
- [x] Event stream tests assert gapless monotonic `seq`, stable `runId`, correct turn grouping, deterministic timestamp behavior, and `agent_end` as final canonical event.
- [x] Existing event type is renamed or isolated as `LegacyAgentEvent` until adapter migration completes.
- [x] `PaAgentMessage` supports user, assistant, and toolResult messages.
- [x] `PaToolResultContent` includes `promptText`, optional `previewText`, `includeInNextPrompt`, optional `sourceRecords`, optional `contextUsed`, and metadata.
- [x] `AssistantMessagePart` supports thinking, text, and toolCall parts in the same assistant message.
- [x] `AgentEndStatus` supports `completed`, `completed_with_warning`, `incomplete`, `aborted`, and `error`.
- [x] `TurnEndStatus` supports `completed`, `tool_results_ready`, `completed_with_warning`, `incomplete`, `aborted`, and `error`.
- [x] `agent_end` terminal semantics are documented in focused tests.

## SPEC-02: PaAgentLoop Direct-Answer Extraction And HostPolicy Shell

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Introduce `pa-agent-loop.ts` as the canonical state machine for direct assistant turns before tool execution. |
| Primary files | `src/ai-services/pa-agent-loop.ts`, `src/ai-services/chat-agent.ts`, PA runtime tests |
| Out of scope | Tool execution, Memory/WebSearch source metadata, required-capability classifier behavior. |

Acceptance checklist:

- [x] Direct answer lifecycle order is `agent_start -> turn_start -> user message -> assistant message -> turn_end -> agent_end`.
- [x] A real user message is emitted only in turn #1.
- [x] Follow-up turns do not re-emit user messages.
- [x] Thinking deltas are emitted as progress and hidden from final answer snapshots.
- [x] Text deltas are optimistic pending final answer content until assistant message end.
- [x] Pending final text commits when assistant message ends with no toolcall.
- [x] Pending final text is reclassified into progress if a synthetic toolcall appears later in the same assistant message.
- [x] In SPEC-02, synthetic toolcall messages are not executed; they end with deterministic incomplete/tool-required diagnostics until SPEC-04 lands.
- [x] HostPolicy shell can decide `continue` or `stop` after `turn_end`.
- [x] `ChatService` adapter can still produce committed-only cumulative legacy `onChunk(snapshot)`.

## SPEC-03: Idle, Provider Error, Abort, And Run Budgets

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Add assistant-provider idle detection, provider error handling, user abort behavior, and run-level budgets without treating long thinking as failure. |
| Primary files | `pa-agent-loop`, runtime primitives, budget policy tests |
| Out of scope | Tool source metadata and required-capability classifier. |

Implementation note:

- Landed: no-first-chunk idle, thinking/text/toolcall idle reset, thinking-only idle, pending-text idle warning, partial-toolcall idle guard, provider error handling, user abort partial text preservation, `maxTurns = 20`, `maxToolCalls = 30`, `maxObservationChars = 24000`, wall-clock stop while blocked on assistant stream, wall-clock stop during tool execution, and wall-clock stop before a follow-up turn starts.
- Tool budget and observation budget behavior are implemented through SPEC-04 structured toolResult messages because those outcomes require the toolResult transcript model.

Acceptance checklist:

- [x] No first chunk triggers idle after the configured test timeout.
- [x] Reasoning/thinking deltas reset idle.
- [x] Text deltas reset idle.
- [x] Toolcall deltas reset idle.
- [x] Thinking-only idle produces `turn_end.status = incomplete` and `agent_end.status = incomplete`.
- [x] Pending-text idle preserves partial answer with `completed_with_warning`.
- [x] Partial toolcall followed by idle does not execute incomplete toolcall.
- [x] Provider error with no visible text yields `error`.
- [x] Provider error after partial text preserves partial answer with `completed_with_warning`.
- [x] User abort preserves partial text in UI but yields `agent_end.status = aborted`.
- [x] `maxTurns = 20` is enforced before starting a new turn.
- [x] Turn 20 is allowed and attempted turn 21 is blocked before `turn_start`.
- [x] `maxToolCalls = 30` is enforced during tool preflight.
- [x] Tool call 30 is allowed and attempted tool call 31 emits budget-skipped toolResult without invoking the real tool.
- [x] `maxWallClockMs = 180000` remains a hard run deadline across assistant stream, tool execution, and between-turn waits.
- [x] Wall-clock expiry during assistant stream is covered.
- [x] Wall-clock expiry during tool execution is covered.
- [x] Wall-clock expiry between turns stops before the next `turn_start`.
- [x] `maxObservationChars = 24000` bounds observation text included in future prompts.
- [x] Observation truncation across multiple toolResults preserves structured sourceRecords and Context Used metadata.
- [x] Budget reached causes post-turn graceful `agent_end`, not a forced final LLM call.

## SPEC-04: Tool-Call Barrier And Structured ToolResult Messages

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Execute parsed assistant tool calls after assistant message end and inject structured toolResult messages. |
| Primary files | `pa-agent-loop`, runtime tests |
| Out of scope | Parallel tool execution; host `CapabilityRegistry` wiring and source-producing Memory/current-note/WebSearch integration, which are owned by SPEC-05. |

Acceptance checklist:

- [x] Tool execution starts only after `message_end: assistant`.
- [x] Streaming toolcall deltas are buffered and parsed only after assistant message end.
- [x] Incomplete or invalid JSON toolcalls are not executed.
- [x] Multiple toolcalls execute sequentially in assistant toolcall order.
- [x] Each tool emits paired `tool_execution_start` and `tool_execution_end`.
- [x] Success, recoverable error, schema invalid, policy rejected, duplicate skipped, budget exceeded, aborted, and abort timeout all emit toolResult messages.
- [x] Recoverable errors, schema invalid, policy rejected, duplicate skipped, and budget skipped outcomes continue best-effort to later toolcalls.
- [x] User abort and wall-clock cap stop remaining tools.
- [x] Abort during tool execution waits up to `toolAbortGraceMs = 2000`.
- [x] Late tool results after abort timeout are discarded from lifecycle/history because execution promises are raced and ignored after timeout.
- [x] Assistant idle does not fire while a tool is running.
- [x] Tool-specific timeout produces the configured tool outcome.
- [x] Wall-clock deadline overrides tool-specific timeout.
- [x] ToolResult inclusion in next prompt follows the plan table.
- [x] Tool outcome tests assert paired events, `isError`, `promptText`, `previewText`, `includeInNextPrompt`, metadata outcome, source/context presence or absence, and whether follow-up prompt includes the observation.
- [x] Per-tool budget skip is distinct from run-level budget stop.
- [x] When `maxToolCalls` is exceeded, remaining toolcalls in the same assistant message receive budget-skipped toolResults for auditability.
- [x] `turn_end.toolResults` preserves assistant tool-call order.
- [x] Existing tool-call parsing matrix remains green.
- [x] SPEC-04 subagent review is complete.

## SPEC-05: Memory/Current-Note/WebSearch Host Integration And Source Ownership

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Connect the canonical loop to PA Memory, current-note context, Core tools, Builtin WebSearch, source records, and metadata. |
| Primary files | `chat-agent`, `core-tool-provider`, `builtin-web-search-provider`, source metadata tests |
| Out of scope | Provider built-in web search fallback; it is not supported. |

Acceptance checklist:

Scope note: checked host-tool items in this SPEC-05 slice prove the standalone canonical `PaAgentLoop` + `CapabilityRegistry` executor behavior. SPEC-06 now owns the PA-aware ChatView/runtime canonical routing path and its focused UI/runtime parity tests.

- [x] Canonical host-tool executor: `search_memory` toolResult feeds the follow-up assistant turn.
- [x] Canonical host-tool executor: benign `search_memory` query alias, missing-argument, and empty-argument drift normalize inside the same read-only Memory tool boundary.
- [x] Canonical host-tool executor: `get_current_note_context` toolResult feeds the follow-up assistant turn.
- [x] Canonical host-tool executor: `webSearch` toolResult feeds the follow-up assistant turn.
- [x] Canonical host-tool executor: Memory content is not injected as hidden pre-context.
- [x] Canonical host-tool executor: Current-note content is not injected as hidden pre-context.
- [x] Canonical loop user message model: user-explicit pasted/selected/uploaded content is represented as user message content.
- [x] Canonical loop hostContext channel: SkillContext is represented as host pre-context in `turn_start.metadata.hostContext`, not fake toolResult.
- [x] Canonical host-tool executor: Memory references remain Memory-only and originate from `search_memory` toolResult sourceRecords.
- [x] Canonical host-tool executor: Current-note context remains current-note/tool context and does not become Memory.
- [x] Canonical host-tool executor: WebSearch sources remain Web sources only when normalized web sources exist.
- [x] Provider built-in web search is not sent to final answer model calls and no provider web status records are emitted.
- [x] Provider web search fallback code paths are removed, not just disabled.
- [x] Settings/defaults/persisted migrations no longer expose provider web fallback.
- [x] Settings UI has no provider web fallback toggle, status text, or copy.
- [x] Provider web fallback tests and fixtures are deleted or rewritten to assert builtin `webSearch` only.
- [x] Canonical host-tool executor: full sourceRecords are canonical on `toolResult.content.sourceRecords`; turn/agent metadata only carries derived summaries.
- [x] Canonical host-tool executor: Tool Context Used entries live on `toolResult.content.contextUsed`.
- [x] Canonical loop diagnostics: Non-tool diagnostics live in `turn_end.metadata.diagnostics`.
- [x] Canonical history helper: new persisted canonical turns carry a schema version.
- [x] Canonical history helper: legacy history source/context metadata is dual-read.
- [x] Canonical history helper: pre-refactor conversations keep source chips and Context Used after ChatView switches to canonical reconstruction.

## SPEC-06: Legacy Adapter And ChatView Lifecycle UI

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Move PA ChatView UI to canonical lifecycle phases while preserving existing public callbacks during migration. |
| Primary files | `chat-agent.ts`, `chat-service.ts`, `chat-view.ts`, `chat-types.ts`, `pa-agent-history.ts`, UI/runtime tests |
| Out of scope | Broad Chat UI redesign. |

Acceptance checklist:

- [x] PA path has a canonical lifecycle event ingress: `onLifecycleEvent?: (event: AgentEvent) => void`.
- [x] PA-aware ChatView requests route through canonical `PaAgentLoop` when `onLifecycleEvent` is provided; no-lifecycle consumers keep the compatibility path.
- [x] Canonical runtime path loads SkillContext as host pre-context, includes it in model input and `turn_start.metadata.hostContext`, and does not emit fake toolResults.
- [x] ChatView canonical lane is the UI source of truth when lifecycle events are present; legacy callbacks are ignored for that live turn.
- [x] PA path groups lifecycle UI phases by canonical `runId + turnId`, not legacy status order or message/tool ids.
- [x] PA path renders phase timeline from lifecycle events.
- [x] Legacy `onChunk` aggregation does not duplicate text rendering.
- [x] Canonical-to-legacy adapter preserves committed-only `onChunk`, hidden reasoning callbacks, and source/context metadata from canonical toolResult messages.
- [x] Thinking content is hidden by default but visible as progress in Thinking/Details.
- [x] Text later followed by toolcall is moved out of the answer area and into progress.
- [x] ToolResult preview is shown only in Thinking/Details and is redacted/truncated.
- [x] Generic warning UI contract renders warning chips/banners from structured metadata without coupling to required-capability policy.
- [x] Unsupported required-capability warning rendering is covered through the generic warning contract and SPEC-07-produced metadata.
- [x] Warning state is saved as structured metadata, not fixed warning copy.
- [x] History re-render can reconstruct warnings from metadata and legacy dual-read source/context data.
- [x] Assistant history stores schema-versioned `canonicalTurn` with `runId`, final `turnId`, final turn status, committed text, host pre-context source/context metadata, and canonical messages.
- [x] Top-level canonical status no longer sticks on `Qwen model is thinking...`.
- [x] Stop/cancel restores composer after `agent_end` in a live Obsidian smoke path.
- [x] Completed turns retain Context Used and source chips.
- [x] Runtime/UI smoke evidence is recorded in SPEC-08; no final deferral remains for SPEC-06.

SPEC-06 focused test matrix:

| Scenario | Automated evidence | Status |
| --- | --- | --- |
| Direct canonical answer | `pa-agent-answer-stream-runtime` canonical lifecycle callback test | Covered |
| Canonical PA runtime routing | `pa-agent-answer-stream-runtime` canonical lifecycle callback test | Covered |
| Text then toolcall reclassification | `chat-view` canonical lifecycle harness | Covered |
| Legacy `onChunk` no duplicate rendering | `chat-view` canonical lifecycle harness and adapter tests | Covered |
| ToolResult preview and Context Used | `chat-view` canonical lifecycle harness | Covered |
| Canonical source/context reconstruction | `pa-agent-history`, `chat-view`, and runtime tests | Covered |
| CanonicalTurn persistence | `chat-view` canonical lifecycle harness and `pa-agent-history` tests | Covered |
| SkillContext host pre-context | `pa-agent-answer-stream-runtime`, `chat-view`, and `pa-agent-history` tests | Covered |
| Warning metadata outside answer body | `chat-view` canonical warning test | Covered |
| Warning metadata redraw | `chat-view` canonical warning redraw test | Covered |
| Canonical runtime tool execution | `pa-agent-answer-stream-runtime` canonical callback test | Covered |
| Cancel settles and next send recovers | `chat-view` cancel recovery send-path test | Covered as automated side evidence |
| Cancel/recovery in Obsidian | SPEC-08 smoke card | Passed |

## SPEC-07: Required-Capability HostPolicy And Classifier

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Detect required/suggested Memory, WebSearch, and current-note capabilities through HostPolicy and make no-call cases source-honest without breaking answer continuity. |
| Primary files | `pa-agent-loop`, `chat-agent` host policy, policy classifier module, metadata/UI tests |
| Out of scope | Provider built-in web search fallback; it is already out of scope. |

Implementation note:

- Landed before review: deterministic fallback classification, HostPolicy-level required/suggested decisions, dedicated `policyModelName` setting, policy-model classifier wrapper, 800ms timeout fallback, invalid/error fallback, late-result discard behavior, first-turn runtime instruction injection through canonical `initialRuntimeInstruction`, one corrective follow-up decision, unavailable-note behavior, structured warning metadata, prompt serialization snapshots, and multi-capability policy matrix.
- Incorporated from SPEC-07 review: required capability use is counted only from successful matching toolResults, no-answer corrective failure emits `incomplete` diagnostics instead of answer-body failure copy, settings privacy copy explicitly discloses configured-provider classification, and prompt snapshot coverage is tightened to full request objects and deterministic tool order.
- Closed by SPEC-08 full checks and Obsidian smoke.

Acceptance checklist:

- [x] Required capability scope is limited to `search_memory`, `webSearch`, and `get_current_note_context`.
- [x] RequiredCapabilityClassifier runs from HostPolicy, not PaAgentLoop.
- [x] Classifier reads only user input and user-explicit sent context.
- [x] Dedicated policy model setting exists or is represented in settings/types.
- [x] Policy model unavailable path uses deterministic fallback rules.
- [x] Classifier timeout is 800ms.
- [x] Timeout/error/invalid output falls back to deterministic rules.
- [x] Late classifier results after timeout are discarded.
- [x] Classifier confidence maps to `required >= 0.75`, `suggested >= 0.45`, `ignore < 0.45`.
- [x] Suggested `>= 0.60` injects a transient runtime hint.
- [x] Suggested `< 0.60` is metadata/telemetry only.
- [x] Deterministic fallback rules distinguish strong required and weak suggested matches.
- [x] Required runtime instruction is appended after user input in the first turn.
- [x] Required instruction uses conditional wording, not absolute commands.
- [x] Dynamic system prompt is not modified for required/corrective/unavailable notes.
- [x] Model request snapshots cover full request objects for baseline, required, corrective, suggested, and unavailable paths.
- [x] Snapshots prove stable system prompt prefix, deterministic tool schema ordering, original user content unchanged, and runtime envelope appended after user content.
- [x] Runtime instruction envelope is not persisted as answer body, Context Used, or source evidence.
- [x] Runtime instruction envelope is absent from normal UI and Thinking/Details.
- [x] Settings/docs privacy copy explains the policy classifier may send user requests to the configured AI provider and does not read hidden vault content.
- [x] Unavailable required capability injects a user-adjacent runtime availability note.
- [x] Unavailable required capability does not trigger corrective turn.
- [x] Available-but-unused required capability triggers at most one corrective turn per run.
- [x] Required capability satisfaction counts only successful matching toolResults.
- [x] Assistant toolcalls and failed/error toolResults do not satisfy required capability policy.
- [x] Corrective turn does not re-emit user message.
- [x] Corrective instruction is not shown in UI or Thinking/Details.
- [x] After corrective, missing required capability with visible answer yields `completed_with_warning`.
- [x] After corrective, missing required capability with no answer yields `incomplete` diagnostic metadata without answer-body failure text.
- [x] Missing required capability warning is metadata only and does not modify final answer body.
- [x] Empty assistant response after successful tool observations gets at most one HostPolicy follow-up retry.
- [x] Empty-response retry is not attempted when no successful prompt observation exists.
- [x] Empty-response retry instruction is transient runtime input and does not change system prompt or answer body.
- [x] Multi-capability matrix covers all satisfied, partially satisfied, one unavailable plus one available, required plus suggested, corrective using only missing capabilities, and warning metadata naming exactly unsatisfied capabilities.
- [x] Builtin WebSearch unavailable/not-called cases do not fall back to provider built-in search.

## SPEC-08: Closeout Verification And Smoke

| Field | Value |
| --- | --- |
| Status | `[x]` Done |
| Goal | Close automated, deploy, and Obsidian test vault gates for the lifecycle runtime. |
| Primary files | tests, docs, tracker, Obsidian test vault |
| Out of scope | New product capabilities. |

Acceptance checklist:

- [x] `npm test -- --runInBand`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `git diff --check`
- [x] `make deploy`
- [x] Obsidian smoke: direct answer.
- [x] Obsidian smoke: current-note context through tool.
- [x] Obsidian smoke: bundled skills as host pre-context.
- [x] Obsidian smoke: SPEC-05 Memory prompt.
- [x] Obsidian smoke: SPEC-05 WebSearch prompt.
- [x] Obsidian smoke: unsupported required capability warning UI.
- [x] Obsidian smoke: cancel/recovery.
- [x] Obsidian console has no runtime errors.
- [x] Each smoke item has a test card with setup, exact prompt, expected visible phases, expected `agent_end.status`, expected source chips, expected Context Used provenance, history reload expectation where relevant, and console/screenshot evidence.

Smoke evidence matrix:

Unless a row says otherwise, expected visible phases are user message -> Thinking/Details progress -> final assistant or warning/diagnostic card -> composer restored. Expected history behavior is that completed assistant turns redraw from canonical history with the same final answer plus source chips / Context Used metadata where applicable. The final DevTools row covers direct console evidence for the resumed smoke session; Computer Use app-state screenshots are the recorded visual evidence.

| Smoke card | Exact prompt / setup | Expected | Current evidence |
| --- | --- | --- | --- |
| Direct answer | `Smoke test direct answer after UI diagnostic fix: answer exactly PA_DIRECT_OK_3 and nothing else.` | Final answer `PA_DIRECT_OK_3`; expected `agent_end.status = completed`; no source chips; no Context Used; composer restored; no lingering Thinking state. | Passed in Obsidian test vault after deploy. |
| Current-note context through tool | Open `test/obsidian-operations/snippet-smoke.md`, then ask for the exact positive snippet token from the current note. | Final answer `pa-positive-snippet-token-1701`; expected `agent_end.status = completed`; current-note tool visible in lifecycle details; Current note source chip / Context Used provenance retained; no WebSearch warning for `current note` wording. | Passed after mode-normalization and classifier fixes. Details show `get_current_note_context` success, `mode = selection-or-nearby`, Current note Context Used, answer `pa-positive-snippet-token-1701`, and `Thinking complete`. |
| Bundled skills as host pre-context | Skill prompt matrix from PA Agent v1 smoke. Current exact prompt set: `Obsidian Markdown skill smoke: explain in one short sentence what wikilinks and callouts are used for.`; `Obsidian Bases skill smoke: in one short sentence, say what .base files use formulas, filters, views, and properties for.`; `JSON Canvas skill smoke: in one short sentence, say how canvas nodes and edges are used.`; `Frontmatter audit skill smoke: in one short sentence, name two frontmatter consistency issues to check, such as property casing and tag spelling.`; `Callout cleanup skill smoke: in one short sentence, name two malformed Obsidian callout issues to check.`; `Vault link health skill smoke: in one short sentence, name two link-health issues such as unresolved wikilinks and orphan notes.`; `Plugin config review skill smoke: in one short sentence, name two config review targets such as disabled plugins and plugin settings.` | SkillContext appears as host pre-context, not fake toolResult; answer remains usable. Expected `agent_end.status = completed`; no source chips; Context Used provenance should show the matching skill guide as `SKILL` and `Not a Memory reference`. | Passed in Obsidian test vault. All 7 prompts produced usable final answers. Thinking details showed the matching `CONTEXT USED <skill-id>`, `Skill guide context`, `SKILL`, and `Not a Memory reference` for `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `pa-frontmatter-audit`, `pa-callout-cleanup`, `pa-vault-link-health`, and `pa-plugin-config-review`. |
| Memory prompt | `根据我的 Memory，我的中文名字是什么？请给出 Memory references。` after deploy/reload with the existing test-vault Memory index available. | Final answer identifies `周至`; expected `agent_end.status = completed`; Thinking details show `search_memory` execution; Memory source chips and Memory Context Used are retained; no `input.query must be a non-empty string` diagnostic. | Passed after Memory query-drift recovery. Final answer said the Chinese name is `周至`; Memory References showed `2025-12-13.md (chunk 0)`; Thinking details showed `search_memory result received`, the original user request used as the read-only Memory query, `Selected Memory`, and `Eligible for Memory references`. |
| WebSearch prompt | `use web search to verify the official Obsidian homepage domain. Answer with the domain only.` with builtin `webSearch` enabled after deploy/reload. | Web source chips from builtin tool only; no provider fallback. Final answer should be `obsidian.md`; expected `agent_end.status = completed`; Context Used should show WebSearch web sources and no `Invalid WebSearch input`. | Passed after missing-args fallback fix. Final answer was `obsidian.md`; Thinking details showed `WebSearch complete`, `webSearch result received`, original user request used as builtin query, `5 normalized web sources`, `Not a Memory reference`, and no `Invalid WebSearch input`. |
| Unsupported required capability warning | Temporarily set deployed test-vault `webSearchEnabled=false`, reload Obsidian, then prompt `请使用 web search 查询当前 Obsidian 官方最新版本，然后用一句话回答。`; restore `webSearchEnabled=true` after the smoke. | Warning metadata UI only; expected `agent_end.status = completed_with_warning`; no warning text appended to answer body; no provider web fallback; no WebSearch source records without a successful builtin toolResult. | Passed. Thinking summary showed `Answer completed with warning`; details showed `WARNINGS`, `Answer may be incomplete`, and `WebSearch was required but was not used.` The final answer explained it could not use web search rather than claiming web evidence. Test-vault setting was restored to `webSearchEnabled=true`. |
| Cancel/recovery | Cancel prompt: `Cancel smoke: for a UI streaming cancellation test, output 1000 numbered lines. Each line must be exactly "PA_CANCEL_STREAM_TOKEN <number>". Start with line 1 immediately, continue line by line, and do not summarize.` Recovery prompt: `After cancel recovery smoke, answer exactly PA_CANCEL_RECOVERY_OK.` | Cancelled turn shows Thinking/progress then `CANCELLED` / `Generation cancelled`; expected `agent_end.status = aborted`; no source chips; no Context Used; composer restored. Next direct prompt should complete with `PA_CANCEL_RECOVERY_OK`, expected `agent_end.status = completed`, and persist normally. | Passed in Obsidian 1.12.7 test vault. Computer Use observed `Generation cancelled`, the composer restored, the recovery prompt sent from the same panel, and final assistant answer `PA_CANCEL_RECOVERY_OK` with `Thinking complete`. |
| DevTools console no-error | After the resumed smoke session, open Obsidian DevTools with `super+alt+i` and inspect the Console tab. | No red runtime errors, unhandled exceptions, or Personal Assistant stack traces after the live smoke sequence; `agent_end.status` is not applicable; no source chips or Context Used. | Passed. DevTools Console was selected and showed only Obsidian Developer Console plus `Settings loaded` from `plugin:personal-assistant`; the toolbar showed no issues and no error/exception rows. |

## Phase Ledger

| Date | SPEC | Change | Status | Evidence |
| --- | --- | --- | --- | --- |
| 2026-05-23 | SPEC-00 | Created lifecycle plan and tracker from runtime architecture discussion. | `[D]` Draft | Docs only. |
| 2026-05-23 | SPEC-00 | Updated plan/tracker with confirmed lifecycle, HostPolicy, budget, classifier, source ownership, and UI warning decisions. | `[D]` Draft | Docs only; first whitespace check passed. |
| 2026-05-23 | SPEC-00 | Incorporated SDD subagent review findings into plan/tracker. | `[D]` Draft | Added migration gates, committed-only legacy chunks, event `scope` and `__run__` audit convention, prompt serialization/privacy gates, history dual-read, budget/tool outcome matrices, multi-capability tests, and smoke test cards. Whitespace checks passed. |
| 2026-05-23 | SPEC-01 | Clarified mandatory canonical event identity contract. | `[D]` Draft | Documented non-optional `runId`/`turnId`, `runId + turnId` audit grouping, `runId + turnId + seq` exact event keys, and centralized `RUN_SCOPE_TURN_ID`. |
| 2026-05-23 | SPEC-00 | Completed current runtime baseline artifact. | `[x]` Done | Added `docs/pa-agent-runtime-lifecycle-baseline.md` with current event sequence, callback contracts, test inventory, rollback/default path, migration allowances, and history compatibility. SPEC-01 moved to `[A]`. |
| 2026-05-23 | SPEC-01 | Implemented canonical event/message/status primitives and legacy event isolation. | `[x]` Done | Added canonical `AgentEvent` v2 types, `LegacyAgentEvent`, `PaAgentMessage`, `PaToolResultContent`, status unions, `AgentLifecycleEventEmitter`, terminal `agent_end` guard, encoded audit keys, and focused tests. SPEC-02 moved to `[A]`. |
| 2026-05-23 | SPEC-02 | Implemented standalone canonical `PaAgentLoop` direct-answer state machine and legacy lifecycle adapter. | `[x]` Done | Added `src/ai-services/pa-agent-loop.ts`, canonical direct-answer tests, HostPolicy after-turn shell, pending text reclassification, SPEC-02 no-tool diagnostic behavior, and `createPaAgentLifecycleLegacyAdapter`. SPEC-03 moved to `[A]`. |
| 2026-05-23 | SPEC-03 | Synced tracker with partial idle/error/abort/budget implementation and optimized target architecture docs. | `[x]` Done | Intermediate tracker sync; later SPEC-03 completion row closes tool budgets, observation budgets, and tool/blocked-stream wall-clock handling. |
| 2026-05-23 | SPEC-05 | Expanded builtin-only WebSearch and provider web fallback removal scope. | `[D]` Draft | Added explicit code, provider request, settings/defaults, settings UI, test/fixture, status-record, source-record, and Context Used cleanup gates. |
| 2026-05-23 | SPEC-03 | Completed run-budget semantics through loop and toolResult budget coverage. | `[x]` Done | Added assistant-stream wall-clock timer, tool-phase wall-clock handling, `maxToolCalls=30`, `maxObservationChars=24000`, and tests for wall-clock assistant/tool/between turns, tool 30/31, and observation truncation preserving source/context metadata. |
| 2026-05-23 | SPEC-04 | Implemented loop-level tool-call barrier and structured toolResult core. | `[x]` Done | Added injected `PaAgentToolExecutor`, buffered toolcall parse after assistant `message_end`, sequential tool execution, paired tool execution events, toolResult messages, outcome matrix tests, abort grace, tool timeout, budget skip, duplicate skip, follow-up transcript injection, and passing subagent re-review. Host `CapabilityRegistry` wiring remains SPEC-05. |
| 2026-05-23 | SPEC-05 | Advanced host integration/source ownership SPEC to review-ready. | `[R]` Ready for review | SPEC-05 acceptance covers Memory/current-note/WebSearch toolResult feeding, builtin-only WebSearch cleanup, source/context ownership, and legacy history dual-read. |
| 2026-05-23 | SPEC-01 | Clarified final event identity decision after user confirmation. | `[x]` Done | Documented that all canonical events use mandatory raw `runId`, `turnId`, and `seq`; no standalone `eventId` is required; run-level events use `RUN_SCOPE_TURN_ID`; encoded helper keys must be delimiter-safe. |
| 2026-05-23 | SPEC-05 | Implemented canonical host-tool executor slice. | `[~]` In progress | Added `createPaAgentCapabilityToolExecutor`, mapping `CapabilityRegistry.execute(...)` results into canonical toolResults with prompt observations, sourceRecords, Context Used, turnId-stamped sources, and hostContext support on `turn_start.metadata`. Default runtime/UI path is not switched yet. |
| 2026-05-23 | SPEC-05 | Verified builtin-only WebSearch/provider fallback cleanup evidence. | `[~]` In progress | Current code exposes only `webSearchEnabled` for the builtin `webSearch` tool, deletes legacy `qwenWebSearchEnabled` during settings migration, and keeps PA final-answer Qwen options limited to thinking. |
| 2026-05-23 | SPEC-05 | Fixed SPEC-05 review findings for host-tool/source ownership slice. | `[~]` In progress | Removed legacy `qwenWebSearchEnabled` influence on builtin WebSearch migration, rewrote the provider tool fixture to a generic unregistered provider signal, added WebSearch no-normalized-source coverage, added negative metadata-duplication assertions, and tightened checklist wording to slice-level evidence. |
| 2026-05-23 | SPEC-05 | Added canonical user-explicit content contract. | `[~]` In progress | `PaAgentLoop` now accepts structured `userMessageContent` for pasted/selected/uploaded user-provided content while keeping hostContext separate for host pre-context such as SkillContext. |
| 2026-05-23 | SPEC-05 | Confirmed canonical non-tool diagnostics ownership. | `[~]` In progress | Existing loop tests cover assistant idle, provider error, and wall-clock diagnostics on `turn_end.metadata.diagnostics`; tool metadata remains on toolResult/tool execution events. |
| 2026-05-23 | SPEC-05 | Completed canonical history reconstruction contract. | `[x]` Done | Added `PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION`, `PaAgentPersistedTurn`, and `pa-agent-history` helpers for schema-versioned canonical turns, canonical source/context reconstruction, and legacy metadata fallback. SPEC-06 moved to `[R]`. |
| 2026-05-23 | SPEC-01/SPEC-06 Docs | Optimized final event identity and UI grouping documentation. | `[x]` Done | Clarified that every canonical event is self-contained for audit/query through raw `runId`, `turnId`, `scope`, and `seq`; added event-type identity matrix; synced SPEC-06 body status to `[R]`; added UI grouping acceptance criterion. |
| 2026-05-23 | SPEC-06 | Implemented canonical lifecycle ingress and ChatView reducer slice. | `[~]` In progress | Added `onLifecycleEvent`, canonical PA runtime routing through `PaAgentLoop` when ChatView requests lifecycle events, ChatView canonical event reducer, pending-text reclassification, canonical tool/source/context rendering, and legacy callback suppression for canonical live turns. |
| 2026-05-23 | SPEC-06 | Added structured warning and history persistence slice. | `[~]` In progress | Added `ChatRuntimeWarning`, persisted canonical turns and warning metadata on assistant history messages, history redraw reconstruction through `readChatHistoryTurnMetadata`, and canonical-to-legacy metadata adaptation from toolResult messages. |
| 2026-05-23 | SPEC-06 Docs | Synced lifecycle plan with current canonical routing and persistence behavior. | `[~]` In progress | Clarified that PA-aware ChatView consumes `onLifecycleEvent` directly, no-lifecycle consumers remain compatibility path, legacy metadata is reconstructed after `agent_end`, and `canonicalTurn`/`runtimeWarnings` are history metadata. |
| 2026-05-23 | SPEC-06 | Wired SkillContext into the canonical runtime path. | `[~]` In progress | Canonical PA runtime now loads selected SkillContext before `PaAgentLoop`, passes it as host pre-context to model input and `turn_start.metadata.hostContext`, and persists skill-guide Context Used/source metadata on `canonicalTurn` without creating toolResult messages. |
| 2026-05-23 | SPEC-06 | Fixed SkillContext review follow-ups. | `[~]` In progress | Added host sourceRecord dedupe across internal turns, stamped host pre-context sourceRecords with the introducing `turnId`, deduped canonical history sourceRecords, and added history redraw/canonical message assertions. |
| 2026-05-23 | SPEC-07 | Started required-capability HostPolicy slice. | `[~]` In progress | Added deterministic required/suggested capability fallback classifier, HostPolicy decisions for first-turn runtime instructions, unavailable notes, one corrective turn, and structured warning metadata. Dedicated policy-model classifier and full prompt snapshot matrix were pending in this slice and are covered by the later focused implementation row. |
| 2026-05-23 | SPEC-07 Docs | Synced classifier/settings slice status into tracker. | `[~]` In progress | Recorded the SPEC-07 policy-model classifier/settings slice as implemented-in-progress but not yet verified. |
| 2026-05-23 | SPEC-07 | Completed focused automated implementation slice. | `[~]` In progress | Added verified policy-model classification fallback/timeout/confidence tests, policy model setting/privacy/migration coverage, canonical prompt serialization snapshots for baseline/required/corrective/suggested/unavailable paths, no-verbatim-runtime-instruction UI coverage, and multi-capability HostPolicy matrix tests. Subagent review and Obsidian smoke remain pending. |
| 2026-05-23 | SPEC-07 Docs | Incorporated review-fix decisions into plan/tracker. | `[~]` In progress | Documented successful-toolResult-only required capability satisfaction, no-answer `incomplete` diagnostics without answer-body failure copy, provider classification privacy disclosure, and full prompt request snapshot expectations. |
| 2026-05-23 | SPEC-07 | Verified review-fix implementation slice. | `[~]` In progress | Focused policy/runtime/settings/UI tests and integrated lifecycle suite passed after review fixes. SPEC-08 full checks and Obsidian smoke remain pending before closeout. |
| 2026-05-23 | SPEC-06/SPEC-07 | Fixed live smoke empty-response handling. | `[~]` In progress | ChatView now renders `assistant_empty_response` diagnostics from `agent_end`/`turn_end` as UI metadata with `Answer incomplete` rather than blank success; HostPolicy allows one retry after successful tool observations before stopping as `incomplete`. |
| 2026-05-23 | SPEC-08 | Recorded closeout gate status after deploy and smoke attempts. | `[~]` In progress | Full tests, lint, build, diff check, and `make deploy` passed. Direct-answer Obsidian smoke passed. Current-note smoke remains open because the latest confirmed result was `Answer incomplete`, not the expected snippet token. |
| 2026-05-23 | SPEC-05/SPEC-07/SPEC-08 | Fixed and verified current-note lifecycle smoke. | `[~]` In progress | Canonical host-tool execution now normalizes benign `get_current_note_context` mode drift before execution; deterministic WebSearch fallback no longer treats `current note` as web freshness. Obsidian smoke returned `pa-positive-snippet-token-1701` with Current note Context Used and no WebSearch warning. |
| 2026-05-23 | SPEC-05/SPEC-08 | Added and verified Memory query-drift recovery for canonical host tools. | `[~]` In progress | Canonical host-tool execution now normalizes benign `search_memory` query aliases and missing/empty arguments after the model explicitly selects the Memory tool, using the original user request as a read-only Memory query when necessary. Focused host-tool and answer-stream runtime tests, typecheck, integrated runtime tests, `make deploy`, and live Obsidian Memory smoke passed. |
| 2026-05-23 | SPEC-01/SPEC-08 Docs | Consolidated final audit identity documentation after SDD discussion. | `[x]` Done | Plan/tracker now distinguish the `runId + turnId` audit/query id marker from the exact `runId + turnId + seq` event record key, keep `turnId` mandatory through `RUN_SCOPE_TURN_ID` for run events, preserve raw identity fields over helper keys, and keep the closeout snapshot focused on remaining smoke gates. |
| 2026-05-23 | SPEC-01/SPEC-08 Docs | Optimized final event identity contract for progress/update events. | `[x]` Done | Plan/tracker now state that `message_update`, `tool_execution_update`, thinking/text/toolcall deltas, and tool progress are not identity-free UI events; they must carry the same `runId`, `turnId`, `scope`, `seq`, and `timestamp` identity contract as lifecycle start/end events. `seq` is documented as run-level gapless ordering that does not reset per turn. |
| 2026-05-23 | SPEC-05/SPEC-08 | Fixed and verified builtin WebSearch lifecycle smoke. | `[~]` In progress | Added host normalization for explicit builtin `webSearch` calls with missing/empty arguments, using the original user request as the read-only builtin query. Focused runtime tests, typecheck, integrated runtime tests, `make deploy`, Obsidian reload, and live WebSearch smoke passed; final answer was `obsidian.md` with WebSearch Context Used and no invalid-input diagnostic. |
| 2026-05-23 | SPEC-08 Smoke | Verified unsupported required-capability warning UI. | `[~]` In progress | With builtin WebSearch temporarily disabled in the deployed test-vault settings, the runtime completed with warning metadata instead of provider web fallback or answer-body diagnostic text. The deployed setting was restored to `webSearchEnabled=true`; Obsidian must be reloaded before any later WebSearch smoke. |
| 2026-05-24 | SPEC-01/SPEC-08 Docs | Synced final audit/query identity wording after latest discussion. | `[x]` Done | Added explicit identity layering: `runId` groups a visible request, `runId + turnId` is the mandatory event id marker / audit scope for every event, and `runId + turnId + seq` is the exact event record key. Updated document revision dates and TODO closeout wording. |
| 2026-05-24 | SPEC-01/SPEC-08 Docs | Optimized audit/query storage and helper contract wording. | `[x]` Done | Plan now documents required future record fields, structured query helper shapes, and rejected identity shortcuts. Tracker records that query helpers should accept structured `runId`/`turnId`/`seq` inputs and must not rely on caller-provided concatenated strings. |
| 2026-05-24 | SPEC-01/SPEC-08 Docs | Added concrete lifecycle identity examples and pre-canonical progress guard. | `[x]` Done | Plan now shows how `agent_start`, turn events, progress/update events, `turn_end`, and `agent_end` all carry `runId + turnId` and use `seq` for exact lookup. Tracker now records that UI/history/diagnostic/adapter paths must not observe lifecycle progress before canonical identity validation. |
| 2026-05-24 | SPEC-08 Smoke | Recorded partial bundled-skill live evidence. | `[~]` In progress | Obsidian test vault smoke passed for `obsidian-markdown`, `obsidian-bases`, and `json-canvas` with matching SkillContext provenance in Thinking details. `pa-frontmatter-audit`, `pa-callout-cleanup`, `pa-vault-link-health`, `pa-plugin-config-review`, cancel/recovery, and console-error gates remain open. |
| 2026-05-24 | SPEC-08 Smoke | Completed bundled-skill live evidence. | `[~]` In progress | Obsidian test vault smoke passed for the remaining `pa-frontmatter-audit`, `pa-callout-cleanup`, `pa-vault-link-health`, and `pa-plugin-config-review` prompts. Each produced a usable final answer and Thinking details showed matching SkillContext provenance as `CONTEXT USED <skill-id>`, `Skill guide context`, `SKILL`, and `Not a Memory reference`. |
| 2026-05-24 | SPEC-08 Smoke | Attempted cancel/recovery smoke; kept gate open. | `[~]` In progress | The first cancel prompt completed normally before Stop could be used, so it is not abort evidence. A longer 300-line cancel prompt started, but the Computer Use stop click hit an invalid/window-lost state and Obsidian then returned to a 0-window Accessibility state. Because no visible stopped run and recovery prompt were verified, cancel/recovery remains open. |
| 2026-05-24 | SPEC-08 Smoke | Re-attempted Obsidian window recovery; kept live gates open. | `[~]` In progress | Recovery attempts covered default app launch, test-vault path launch, Obsidian deep link, clean local profile with `--user-data-dir`, app menu `Open Vault...`, `Open Recent > test`, `Window > snippet-smoke - test - Obsidian 1.12.7`, `Bring All to Front`, and a screen capture probe. macOS System Events still reported `count of windows = 0`, Computer Use `get_app_state` timed out, and `screencapture` could not create an image. This is an environment/window recovery failure, not runtime smoke evidence; cancel/recovery and direct console-error gates remain open. |
| 2026-05-24 | SPEC-06/SPEC-08 | Added automated cancel recovery send-path side evidence. | `[~]` In progress | ChatView now has a focused test that cancels a turn, waits for the abort to settle, sends a new recovery prompt through the normal Ask path, and verifies the recovery answer commits to chat history with no cancelled turn in model history. This reduces regression risk but does not close the required live Obsidian cancel/recovery smoke gate. |
| 2026-05-24 | SPEC-08 Smoke | Completed live cancel/recovery and direct console closeout. | `[x]` Done | Obsidian 1.12.7 test vault became Computer Use-readable again. The live chat panel showed the long cancel prompt ending in `CANCELLED` / `Generation cancelled`, then the same panel accepted `After cancel recovery smoke, answer exactly PA_CANCEL_RECOVERY_OK.` and returned `PA_CANCEL_RECOVERY_OK` with `Thinking complete`. DevTools Console opened via `super+alt+i` and showed only Obsidian Developer Console plus `Settings loaded`, with no runtime errors or issues. |
| 2026-05-24 | SPEC-06/SPEC-07/SPEC-08 | Closed lifecycle runtime tracker. | `[x]` Done | SPEC-06 runtime/UI smoke, SPEC-07 required-capability closeout, and SPEC-08 smoke matrix are complete. Remaining release readiness is the normal repository release process, not an open lifecycle tracker gate. |

## Review Log

| Date | Review | Reviewer | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-23 | Runtime plan review | Reference-alignment subagent | Request changes | Required toolResult messages, `agent_end` terminal semantics, idle scope, and pi-style event contract were incorporated into the lifecycle plan. |
| 2026-05-23 | Runtime plan review | Verification subagent | Request changes | Added stuck-stream fixtures, idle fake-timer cases, no-tool diagnostics, and Obsidian smoke gates. |
| 2026-05-23 | Runtime plan review | Implementation-risk subagent | Request changes | Added adapter compatibility, terminal ordering, replay after visible reasoning/toolcall, and paired tool execution requirements. |
| 2026-05-23 | Scope review | Architecture and programmer subagents | Re-scoped by product decision | Minimal-patch option was rejected; canonical lifecycle refactor is the intended direction. |
| 2026-05-23 | Product decision review | User discussion | Accepted direction | Confirmed full canonical lifecycle, HostPolicy separation, run budgets, LLM classifier, one corrective turn, UI metadata warnings, and no provider web fallback. |
| 2026-05-23 | Event identity decision | User discussion | Accepted direction | All canonical events need id markers for audit/query. The event id marker is the mandatory raw `runId + turnId` pair; run-level events use `RUN_SCOPE_TURN_ID`; `seq` completes the exact event record key as `runId + turnId + seq`; `turnId` is not optional; no standalone opaque `eventId` is introduced. |
| 2026-05-24 | Event identity wording audit | User discussion | Accepted direction | Reconfirmed that the product-facing phrase "every event needs an id marker" maps to raw structured `runId + turnId` on every canonical event. The implementation spelling remains `runId` / `turnId`; `runID` / `turnID` are not separate fields. |
| 2026-05-23 | SPEC-01 architecture review | Runtime architecture subagent | Request changes, fixed | Fixed terminal `agent_end` enforcement, audit key delimiter collision risk, and tracker status drift. |
| 2026-05-23 | SPEC-01 SDD/testing review | Verification subagent | Request changes, fixed | Fixed SPEC-00 repeated-user-message baseline evidence, tracker status drift, missing verification log, and strengthened event/message/status/toolResult tests. |
| 2026-05-23 | SPEC-02 lifecycle review | Runtime lifecycle subagent | Request changes, fixed | Fixed assistant text reclassification in canonical message content, added HostPolicy-after-`turn_end` assertion, and updated tracker evidence. |
| 2026-05-23 | SPEC-02 SDD/testing review | Verification subagent | Request changes, fixed | Added canonical-to-legacy `ChatService` adapter test for committed-only cumulative `onChunk`, plus SPEC-02 verification evidence. |
| 2026-05-23 | SPEC-03 status audit | Codex implementation audit | Accepted with pending items | Tracker now distinguishes implemented idle/error/abort/maxTurns behavior from pending tool budgets, observation budgets, and wall-clock enforcement during blocked assistant stream or tool execution. |
| 2026-05-23 | Provider WebSearch cleanup decision | User discussion | Accepted direction | Provider web fallback must be removed from code, UI, settings, and tests; all web search must flow through builtin `webSearch`. |
| 2026-05-23 | SPEC-04 runtime architecture review | Runtime architecture subagent | Request changes, fixed | Fixed provider stream setup sync errors, HostPolicy wall-clock/error supervision, tool executor sync throw pairing, structured no-executor toolResults, budget ownership docs, index-order tool execution, and budget-skipped remaining calls. Re-review found no P0/P1/P2 blockers. |
| 2026-05-23 | SPEC-04 SDD/testing review | Verification subagent | Request changes, fixed | Fixed tracker drift, added HostPolicy supervision tests, index-order tests, maxToolCalls remaining-budget tests, and outcome matrix coverage. Re-review found no P0/P1/P2 blockers. |
| 2026-05-23 | SPEC-05 runtime architecture review | Runtime architecture subagent | Request changes, fixed | No P0/P1 source ownership blockers. Addressed P2/P3 findings by removing legacy provider-web setting influence, adding no-normalized-WebSearch-source coverage, rewriting provider-web fixture wording, and tightening tracker scope to canonical host-tool executor slice. Re-review found no P0/P1/P2 blockers. |
| 2026-05-23 | SPEC-05 SDD/testing review | Verification subagent | Request changes, fixed | Added direct migration test for deleting `qwenWebSearchEnabled`, WebSearch no-source negative test, stronger hidden-precontext assertions, and negative assertions that full source/context metadata stays off turn/agent metadata. Re-review found no P0/P1/P2 blockers. |
| 2026-05-23 | SPEC-06 runtime architecture review | Runtime architecture subagent | Request changes, fixed | Findings covered canonical lifecycle ingress, legacy duplicate rendering, adapter metadata, run/turn UI grouping, pending text reclassification, source/context ownership, `agent_end` terminal behavior, and provider-specific thinking text. Current implementation adds lifecycle ingress, canonical reducer, no-duplicate path, metadata adapter, canonical status wording, and SPEC-08 terminal smoke evidence. |
| 2026-05-23 | SPEC-06 SDD/testing review | Verification subagent | Request changes, fixed | Added canonical event UI harness, warning metadata tests, canonical runtime lifecycle test, adapter metadata test, SPEC-06 focused test matrix, and SPEC-08 cancel/recovery live smoke evidence. |
| 2026-05-23 | SPEC-06 documentation sync | Codex implementation audit | Accepted | Plan and tracker now distinguish implemented canonical ChatView routing from final closeout gates, and record `canonicalTurn` plus `runtimeWarnings` as history metadata rather than answer body content. |
| 2026-05-23 | SPEC-06 SkillContext SDD/testing review | Verification subagent | Request changes, fixed | Added multi-turn SkillContext coverage, no fake toolResult assertions, `tool_observations` negative assertion, canonical message persistence assertions, and history redraw coverage. |
| 2026-05-23 | SPEC-06 SkillContext architecture review | Runtime architecture subagent | Request changes, fixed | Fixed duplicate host sourceRecords across internal turns and stamped host pre-context sourceRecords with the canonical `turnId` that introduced them. |
| 2026-05-23 | SPEC-07 runtime architecture review | Runtime architecture subagent | Request changes, fixed in current slice | Fixed the P1 false-satisfaction path by counting required capability use only from successful matching toolResults. The P2 no-lifecycle canonical-path concern is accepted as a migration-gate risk because current plan explicitly keeps no-lifecycle consumers on the compatibility path until they migrate. |
| 2026-05-23 | SPEC-07 SDD/testing review | Verification subagent | Request changes, fixed | Tightened provider privacy copy, full prompt request snapshot coverage, and no-answer corrective diagnostics. Focused and integrated lifecycle tests passed after the fixes. |

## Verification Log

| Date | SPEC | Command / Smoke | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-23 | SPEC-00 | `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Whitespace checks passed after confirmed lifecycle decision doc update. The two docs are currently untracked files, so `--no-index` was used for the file-level check. |
| 2026-05-23 | SPEC-00 | `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Whitespace checks passed after SDD review updates. |
| 2026-05-23 | SPEC-01 | `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Whitespace checks passed after mandatory event identity contract update. The two `--no-index` checks produced no whitespace output; nonzero exit is expected because untracked docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-00 | `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-baseline.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-baseline.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-baseline.md` | Passed | Baseline artifact whitespace checks passed. The baseline doc is currently untracked, so `--no-index` was used for file-level checking. |
| 2026-05-23 | SPEC-01 | `npm test -- __tests__/agent-runtime-primitives.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npm test -- __tests__/chat-service.test.ts --runInBand`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-baseline.md src/ai-services/chat-types.ts src/ai-services/agent-runtime-primitives.ts src/ai-services/chat-service.ts src/ai-services/chat-agent.ts __tests__/agent-runtime-primitives.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-baseline.md src/ai-services/chat-types.ts src/ai-services/agent-runtime-primitives.ts src/ai-services/chat-service.ts src/ai-services/chat-agent.ts __tests__/agent-runtime-primitives.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts` | Passed | Focused primitives passed 8 tests; PA answer-stream compatibility passed 12 tests; ChatService compatibility passed 145 tests; typecheck passed. Obsidian smoke is deferred to SPEC-08 because SPEC-01 adds types/primitives and keeps the default runtime/UI path on `LegacyAgentEvent`. |
| 2026-05-23 | SPEC-02 | `npm test -- __tests__/pa-agent-loop.test.ts --runInBand`; `npm test -- __tests__/agent-runtime-primitives.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `npm test -- __tests__/chat-service.test.ts --runInBand`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `git diff --check -- src/ai-services/pa-agent-loop.ts __tests__/pa-agent-loop.test.ts src/ai-services/chat-service.ts __tests__/chat-service.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" src/ai-services/pa-agent-loop.ts __tests__/pa-agent-loop.test.ts src/ai-services/chat-service.ts __tests__/chat-service.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | PaAgentLoop focused tests passed 4 tests; primitives plus loop passed 12 tests; ChatService compatibility passed 146 tests; PA answer-stream compatibility passed 12 tests; typecheck passed. Obsidian smoke is deferred to SPEC-08 because SPEC-02 keeps the standalone canonical loop behind tests and does not switch default runtime/UI behavior. |
| 2026-05-23 | SPEC-03 / Docs | `npm test -- __tests__/pa-agent-loop.test.ts --runInBand`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-development-tracker.md` | Passed | PaAgentLoop focused tests passed 14 tests. Documentation whitespace checks passed; trailing-whitespace scan produced no matches. Obsidian smoke remains deferred because SPEC-03 still uses the standalone canonical loop and does not switch the default runtime/UI path. |
| 2026-05-23 | SPEC-03/SPEC-04 | `npm test -- __tests__/pa-agent-loop.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `npm test -- __tests__/agent-runtime-primitives.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `npm test -- __tests__/chat-service.test.ts --runInBand`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npm test -- __tests__/tool-calling-protocol.test.ts --runInBand`; `git diff --check -- src/ai-services/pa-agent-loop.ts src/ai-services/chat-types.ts src/ai-services/agent-runtime-primitives.ts __tests__/pa-agent-loop.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-development-tracker.md`; `rg -n "[[:blank:]]+$" src/ai-services/pa-agent-loop.ts src/ai-services/chat-types.ts src/ai-services/agent-runtime-primitives.ts __tests__/pa-agent-loop.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-development-tracker.md` | Passed | PaAgentLoop focused tests passed 43 tests; primitives plus loop passed 51 tests; ChatService compatibility passed 146 tests; PA answer-stream compatibility passed 12 tests; tool-calling protocol matrix passed 6 tests; typecheck passed; whitespace checks passed. Obsidian smoke remains deferred because SPEC-04 is standalone loop-level runtime and does not switch the default runtime/UI path. |
| 2026-05-23 | SPEC-01 Docs | `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation whitespace checks passed after final event identity clarification. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because the docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-05 | `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-loop.test.ts __tests__/agent-runtime-primitives.test.ts __tests__/capability-registry.test.ts __tests__/builtin-web-search-provider.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand` | Passed | New host-tool tests passed with loop tests, then six related suites passed 90 tests. Covers canonical `CapabilityRegistry` executor for `search_memory`, `get_current_note_context`, builtin `webSearch`, sourceRecords on `toolResult.content.sourceRecords`, Context Used on `toolResult.content.contextUsed`, hostContext in `turn_start.metadata`, no fake SkillContext toolResult, and legacy PA answer-stream compatibility. Obsidian smoke remains deferred because this slice still does not switch the default runtime/UI path. |
| 2026-05-23 | SPEC-05 | `rg -n "web_search|webSearch|web_search_options|enableSearch|enable_search|search_options|provider_web_search|builtin WebSearch|WebSearch tool|webSearchEnabled" src __tests__`; `npm test -- __tests__/settings.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npm test -- __tests__/plugin-record-note.test.ts --runInBand` | Superseded | Initial provider-cleanup evidence row superseded after subagent review found the legacy migration test too weak and the provider-web fixture wording too specific. |
| 2026-05-23 | SPEC-05 | `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `npm test -- __tests__/plugin-record-note.test.ts __tests__/settings.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand` | Passed | Host-tool plus loop tests passed 48 tests after adding WebSearch no-normalized-source and metadata ownership negative assertions. Plugin/settings/ChatService/PA answer-stream passed 182 tests after direct legacy `qwenWebSearchEnabled` deletion coverage and generic unregistered provider tool fixture rewrite. |
| 2026-05-23 | SPEC-05 Review | Runtime architecture and SDD/testing subagent re-review | Passed | Both re-reviews reported no remaining P0/P1/P2 blockers for the canonical host-tool executor slice. |
| 2026-05-23 | SPEC-05 | `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-loop.test.ts __tests__/agent-runtime-primitives.test.ts __tests__/capability-registry.test.ts __tests__/builtin-web-search-provider.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/plugin-record-note.test.ts __tests__/settings.test.ts __tests__/chat-service.test.ts --runInBand` | Passed | Integrated SPEC-05-focused test set passed 9 suites / 262 tests after review fixes and structured user message content coverage. |
| 2026-05-23 | SPEC-05 | `npx tsc -noEmit -skipLibCheck`; `git diff --check -- src/plugin.ts __tests__/plugin-record-note.test.ts __tests__/chat-service.test.ts src/ai-services/pa-agent-loop.ts docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null src/ai-services/pa-agent-host-tools.ts`; `git diff --no-index --check -- /dev/null __tests__/pa-agent-host-tools.test.ts`; `rg -n "[[:blank:]]+$" src/plugin.ts __tests__/plugin-record-note.test.ts __tests__/chat-service.test.ts src/ai-services/pa-agent-loop.ts src/ai-services/pa-agent-host-tools.ts __tests__/pa-agent-host-tools.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Final typecheck and whitespace checks passed for the SPEC-05 host-tool slice. The two `--no-index` checks produced no whitespace output; nonzero exit is expected because untracked new files differ from `/dev/null`. |
| 2026-05-23 | SPEC-05 | `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Host-tool plus loop tests passed 49 tests after adding structured user message content coverage. Typecheck passed. |
| 2026-05-23 | SPEC-05 | `npm test -- __tests__/pa-agent-history.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | History/host-tool/loop tests passed 3 suites / 53 tests. Covers schema-versioned canonical turn persistence, canonical source/context reconstruction from toolResult messages, legacy metadata fallback, and pre-refactor source/context preservation contract. Obsidian smoke remains deferred because SPEC-05 does not switch the default ChatView rendering path; SPEC-06/SPEC-08 own UI and live smoke. |
| 2026-05-23 | SPEC-05 | `npx tsc -noEmit -skipLibCheck`; `git diff --check -- src/ai-services/pa-agent-loop.ts docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null src/ai-services/pa-agent-host-tools.ts`; `git diff --no-index --check -- /dev/null __tests__/pa-agent-host-tools.test.ts`; `rg -n "[[:blank:]]+$" src/ai-services/pa-agent-loop.ts src/ai-services/pa-agent-host-tools.ts __tests__/pa-agent-host-tools.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Typecheck passed. Changed tracked files had no whitespace errors; untracked new files produced no whitespace output under `--no-index`; trailing-whitespace scan produced no matches. |
| 2026-05-23 | SPEC-01/SPEC-06 Docs | `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation whitespace checks passed after final event identity and SPEC-06 status sync. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because the docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-06 | `npm test -- __tests__/chat-view.test.ts --runInBand`; `npm test -- __tests__/chat-service.test.ts --runInBand`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-host-tools.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | ChatView passed 79 tests with canonical lifecycle UI harness and warning redraw coverage; ChatService passed 147 tests with canonical adapter metadata coverage; runtime/loop/host-tool passed 62 tests with canonical lifecycle callback and toolResult source/context evidence; typecheck passed. |
| 2026-05-23 | SPEC-06 | `npm test -- __tests__/chat-view.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-history.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Integrated SPEC-06-focused test set passed 6 suites / 292 tests. Obsidian smoke remains pending; SPEC-06 is not marked Done until smoke evidence or explicit final deferral is recorded. |
| 2026-05-23 | SPEC-06 Docs | `rg -n "must not replace|default PA path may switch|default runtime path|onLifecycleEvent|canonicalTurn|runtimeWarnings|Legacy metadata|compatibility path" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation sync verified after canonical routing/history updates. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because untracked docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-06 | `npm test -- __tests__/pa-agent-history.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/chat-view.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Focused SkillContext/canonical history/UI runtime set passed 3 suites / 99 tests. Covers SkillContext host pre-context injection into model input and `turn_start.metadata.hostContext`, no fake toolResult, Context Used rendering, `canonicalTurn` persistence, and history reconstruction. |
| 2026-05-23 | SPEC-06 | `npm test -- __tests__/chat-view.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-history.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Integrated SPEC-06-focused test set passed 6 suites / 295 tests after SkillContext host pre-context wiring. Typecheck passed. Obsidian smoke remains pending; SPEC-06 is not marked Done until smoke evidence or explicit final deferral is recorded. |
| 2026-05-23 | SPEC-06 | `git diff --check -- src/ai-services/chat-types.ts src/ai-services/pa-agent-history.ts src/ai-services/chat-agent.ts src/chat-view.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/chat-view.test.ts docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" src/ai-services/chat-types.ts src/ai-services/pa-agent-history.ts src/ai-services/chat-agent.ts src/chat-view.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/chat-view.test.ts docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Whitespace checks passed for the SkillContext canonical wiring slice. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because untracked docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-06/SPEC-07 | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/chat-view.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Focused SkillContext review-fix plus required-capability HostPolicy set passed 4 suites / 103 tests. Covers sourceRecord dedupe/turnId stamping, history redraw, no fake SkillContext toolResult, deterministic classification, unavailable notes, one corrective decision, suggested hints, and warning metadata. |
| 2026-05-23 | SPEC-06/SPEC-07 | `npm test -- __tests__/chat-view.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-required-capability-policy.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Integrated lifecycle-focused set passed 7 suites / 299 tests after SPEC-06 review fixes and SPEC-07 first HostPolicy slice. Typecheck passed. |
| 2026-05-23 | SPEC-06/SPEC-07 | `git diff --check -- src/ai-services/pa-agent-loop.ts src/ai-services/pa-agent-required-capability-policy.ts src/ai-services/chat-agent.ts src/ai-services/pa-agent-history.ts src/chat-view.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/chat-view.test.ts docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" src/ai-services/pa-agent-loop.ts src/ai-services/pa-agent-required-capability-policy.ts src/ai-services/chat-agent.ts src/ai-services/pa-agent-history.ts src/chat-view.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/chat-view.test.ts docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null src/ai-services/pa-agent-required-capability-policy.ts`; `git diff --no-index --check -- /dev/null __tests__/pa-agent-required-capability-policy.test.ts` | Passed | Whitespace checks passed for SPEC-06 review fixes and SPEC-07 first HostPolicy slice. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because untracked files differ from `/dev/null`. |
| 2026-05-23 | SPEC-01/SPEC-07 Docs | `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation whitespace checks passed after latest event identity and SPEC-07 status sync. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because untracked docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-07 | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts --runInBand`; `npm test -- __tests__/settings.test.ts __tests__/plugin-record-note.test.ts --runInBand`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npm test -- __tests__/chat-view.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Focused SPEC-07 suites passed after policy-model classifier/settings/prompt updates. Covers classifier fallback/timeout/error/late-result/confidence boundaries, policy model setting/privacy/migration, canonical prompt snapshots for baseline/required/corrective/suggested/unavailable paths, no-verbatim-runtime-instruction UI rendering, unavailable WebSearch warnings without provider fallback, and multi-capability HostPolicy matrix. |
| 2026-05-23 | SPEC-07 | `npm test -- __tests__/chat-view.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts __tests__/ai-utils.test.ts __tests__/capability-registry.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Superseded | Integrated lifecycle-focused set passed 11 suites / 380 tests before SPEC-07 subagent review fixes. Later verification row covers the post-review state. |
| 2026-05-23 | SPEC-07 | `git diff --check -- src/ai-services/chat-agent.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts __tests__/chat-view.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-plan.md`; `rg -n "[[:blank:]]+$" src/ai-services/chat-agent.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts __tests__/chat-view.test.ts docs/pa-agent-runtime-lifecycle-development-tracker.md docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Whitespace checks passed for the SPEC-07 classifier/settings/prompt slice. The two `--no-index` commands produced no whitespace output; nonzero exit is expected because untracked docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-07 Docs | `rg -n "successful matching toolResult|answer-body failure|SPEC-07 runtime architecture review|No-lifecycle consumers|identity markers|RuntimeDiagnostic|diagnostics" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation sync and whitespace checks passed after incorporating SPEC-07 review-fix decisions. The `rg` trailing-whitespace command produced no matches; the two `--no-index` commands produced no whitespace output and nonzero diff exit is expected for untracked docs. |
| 2026-05-23 | SPEC-07 | `npx tsc -noEmit -skipLibCheck`; `npm test -- __tests__/pa-agent-required-capability-policy.test.ts --runInBand`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npm test -- __tests__/settings.test.ts --runInBand`; `npm test -- __tests__/chat-view.test.ts --runInBand`; `npm test -- __tests__/plugin-record-note.test.ts --runInBand`; `npm test -- __tests__/chat-view.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-history.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/settings.test.ts __tests__/plugin-record-note.test.ts __tests__/ai-utils.test.ts __tests__/capability-registry.test.ts --runInBand` | Passed | Typecheck passed. Focused tests passed: required-capability policy 13 tests, answer-stream runtime 21 tests, settings 13 tests, ChatView 81 tests, plugin-record-note 13 tests. Integrated lifecycle-focused set passed 11 suites / 385 tests after SPEC-07 review fixes. |
| 2026-05-23 | SPEC-01 Docs | `rg -n 'event id marker|RUN_SCOPE_TURN_ID|finalTurnId|runId \\+ turnId \\+ seq|standalone .*eventId|isolated event-record' docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation sync verified after final event id marker decision. The trailing-whitespace scan produced no matches; `git diff --check` passed; the two `--no-index` checks produced no whitespace output and nonzero diff exit is expected because untracked docs differ from `/dev/null`. |
| 2026-05-23 | SPEC-01 Docs | `rg -n "id marker|runId \\+ turnId|exact-record discriminator|eventId" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation wording verified after the audit/query id marker sync. The plan/tracker now separate the mandatory `runId + turnId` event id marker from `seq` as the exact-record discriminator. The trailing-whitespace scan produced no matches; `git diff --check` passed; the two `--no-index` checks produced no whitespace output and nonzero diff exit is expected for untracked docs. |
| 2026-05-23 | SPEC-01 Docs | `rg -n "event id marker|runId \\+ turnId|RUN_SCOPE_TURN_ID|scope.*/.*turnId|eventId|exact event lookup|seq" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation sync verified after consolidating the final event identity contract. Keyword scan found the expected audit identity and `scope`/`turnId` validation terms; trailing-whitespace scan produced no matches; `git diff --check` passed; the two `--no-index` checks produced no whitespace output and nonzero diff exit is expected for untracked docs. |
| 2026-05-23 | SPEC-06/SPEC-07 | `npm test -- __tests__/chat-view.test.ts --runInBand`; `npm test -- __tests__/pa-agent-loop.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `npm test -- __tests__/pa-agent-required-capability-policy.test.ts --runInBand` | Passed | ChatView passed 82 tests including incomplete diagnostic rendering and no answer-body diagnostic copy. PaAgentLoop passed 45 tests. Required-capability HostPolicy passed 14 tests including one empty-response retry after successful tool observations. Typecheck passed. |
| 2026-05-23 | SPEC-08 | `npm test -- --runInBand`; `npm run lint`; `npm run build`; `git diff --check`; `make deploy` | Passed | Full suite passed 43 suites / 684 tests; lint passed; build passed with Browserslist stale-data warning only; whitespace check passed; deploy rebuilt and copied plugin assets into the Obsidian test vault. |
| 2026-05-23 | SPEC-08 Smoke | Obsidian test vault direct-answer prompt `Smoke test direct answer after UI diagnostic fix: answer exactly PA_DIRECT_OK_3 and nothing else.` | Passed | The assistant returned `PA_DIRECT_OK_3`, Thinking completed, and the composer recovered for the next prompt. |
| 2026-05-23 | SPEC-08 Smoke | Obsidian test vault current-note prompt against `test/obsidian-operations/snippet-smoke.md` asking for `pa-positive-snippet-token-1701`. | Failed / open | The UI no longer showed a blank successful answer; it rendered `Answer incomplete`. This confirms the diagnostic UX fix but does not close the current-note answer smoke gate. |
| 2026-05-23 | SPEC-05/SPEC-07 | `npm test -- __tests__/pa-agent-host-tools.test.ts --runInBand`; `npm test -- __tests__/pa-agent-loop.test.ts --runInBand`; `npm test -- __tests__/pa-agent-required-capability-policy.test.ts --runInBand`; `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck` | Passed | Host-tool mode normalization test passed; PaAgentLoop passed 45 tests; required-capability policy passed 15 tests including no WebSearch classification for current-note prompts; host-tools plus answer-stream runtime passed 28 tests; typecheck passed. |
| 2026-05-23 | SPEC-08 | `make deploy` | Passed | Full suite passed 43 suites / 686 tests; lint passed; build passed with Browserslist stale-data warning only; deploy rebuilt and copied plugin assets into the Obsidian test vault after mode-normalization and classifier fixes. |
| 2026-05-23 | SPEC-08 Smoke | Obsidian test vault current-note classifier-fix prompt against `test/obsidian-operations/snippet-smoke.md`. | Passed | The assistant returned `pa-positive-snippet-token-1701`; Thinking summary ended as `Thinking complete`; details showed `get_current_note_context` success with normalized `mode = selection-or-nearby`, Current note Context Used, and no WebSearch warning. |
| 2026-05-23 | SPEC-01/SPEC-08 Docs | `rg -n "query scope|unique row|exact event record key|Field naming|Consolidated final audit identity|runId \\+ turnId \\+ seq" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation optimization verified after the final audit/query discussion. The plan/tracker now separate `runId + turnId` as the audit/query marker from `runId + turnId + seq` as the exact event record key; keyword checks found the expected terms; whitespace checks produced no output. |
| 2026-05-23 | SPEC-01/SPEC-08 Docs | `rg -n "identity-free|progress/update|does not reset|run-level gapless|message_update|tool_execution_update|runId \\+ turnId \\+ seq" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --check -- docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation optimization verified after clarifying that progress/update events are auditable canonical events and that `seq` is run-level gapless ordering. Keyword checks found the expected terms; trailing-whitespace scan and diff checks produced no output. The two `--no-index` checks return nonzero because the docs differ from `/dev/null`, but produced no whitespace errors. |
| 2026-05-23 | SPEC-05/SPEC-08 | `npm test -- __tests__/pa-agent-host-tools.test.ts --runInBand --testNamePattern WebSearch`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand --testNamePattern WebSearch`; `npx tsc -noEmit -skipLibCheck`; `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts __tests__/pa-agent-loop.test.ts --runInBand`; `make deploy`; Obsidian test vault smoke prompt `use web search to verify the official Obsidian homepage domain. Answer with the domain only.` | Passed | Focused WebSearch tests passed 4 host-tool tests and 10 answer-stream tests; typecheck passed; integrated runtime set passed 3 suites / 82 tests; `make deploy` passed 43 suites / 695 tests plus lint/build/copy. Obsidian 1.12.7 test vault after reload returned `obsidian.md`; Thinking details showed `WebSearch complete`, `webSearch result received`, `5 normalized web sources`, and no `Invalid WebSearch input`. |
| 2026-05-23 | SPEC-05/SPEC-08 | `npm test -- __tests__/pa-agent-host-tools.test.ts --runInBand --testNamePattern search_memory`; `npm test -- __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand --testNamePattern "Memory query"`; `npm test -- __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-answer-stream-runtime.test.ts --runInBand`; `npm test -- __tests__/pa-agent-loop.test.ts __tests__/pa-agent-required-capability-policy.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `make deploy`; Obsidian test vault Memory prompt `根据我的 Memory，我的中文名字是什么？请给出 Memory references。` | Passed | Focused Memory query-drift tests passed, integrated host-tool/answer-stream runtime tests passed 2 suites / 40 tests, loop/policy tests passed 2 suites / 60 tests, typecheck passed, and `make deploy` passed 43 suites / 698 tests plus lint/build/copy. Obsidian 1.12.7 test vault after reload answered `周至`; Thinking details showed successful `search_memory` with original prompt fallback and Memory reference provenance. |
| 2026-05-23 | SPEC-08 Smoke | Temporarily disable builtin WebSearch in deployed test-vault settings, reload Obsidian, prompt `请使用 web search 查询当前 Obsidian 官方最新版本，然后用一句话回答。`, then restore `webSearchEnabled=true`. | Passed | Obsidian rendered warning metadata instead of provider fallback: Thinking summary showed `Answer completed with warning`; details showed `WARNINGS`, `Answer may be incomplete`, and `WebSearch was required but was not used.` The final answer did not claim web evidence. The setting file was restored to `webSearchEnabled=true`; reload is required before later WebSearch smoke. |
| 2026-05-24 | SPEC-08 Smoke | Obsidian test vault bundled-skill prompts for `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `pa-frontmatter-audit`, `pa-callout-cleanup`, `pa-vault-link-health`, and `pa-plugin-config-review`. | Passed | All seven skill prompts passed with usable final answers and matching Context Used provenance. The four later prompts verified `pa-frontmatter-audit`, `pa-callout-cleanup`, `pa-vault-link-health`, and `pa-plugin-config-review` in Thinking details with `Skill guide context`, `SKILL`, and `Not a Memory reference`. |
| 2026-05-24 | SPEC-08 Smoke | `rg -n "Error|error|Exception|Unhandled|personal-assistant|Personal Assistant|agent|runtime|TypeError|ReferenceError" "$HOME/Library/Application Support/obsidian/obsidian.log"` | Informational / open | The Obsidian app log scan produced no matches for the recent smoke session. This is useful side evidence only; it does not close the DevTools console-error gate because it is not a direct console inspection. |
| 2026-05-24 | SPEC-01/SPEC-08 Docs | `rg -n "Future audit/query storage contract|Canonical query helpers|Rejected identity shapes|runId \\+ turnId \\+ seq|RUN_SCOPE_TURN_ID|Future audit/query helper contract" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `git diff --check -- docs/todo.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation keyword checks found the new audit/query storage and helper contract terms. Trailing-whitespace scan produced no matches; `docs/todo.md` diff check passed; the two `--no-index` checks produced no whitespace output and nonzero exit is expected because the runtime lifecycle docs are untracked. |
| 2026-05-24 | SPEC-01/SPEC-08 Docs | `rg -n "Concrete lifecycle identity examples|pre-canonical progress|Event identity implementation guard|identity validation|runId \\+ turnId \\+ seq|RUN_SCOPE_TURN_ID" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `rg -n "[[:blank:]]+$" docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `git diff --check -- docs/todo.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Documentation checks found the concrete lifecycle identity examples and pre-canonical progress guard. Trailing-whitespace scan produced no matches; `docs/todo.md` diff check passed; the two `--no-index` checks produced no whitespace output and nonzero exit is expected because the runtime lifecycle docs are untracked. |
| 2026-05-24 | SPEC-08 Smoke | Cancel/recovery prompt attempts: `Cancel smoke: write a very long answer with 30 numbered paragraphs about Obsidian note organization.`; `Cancel smoke: write 300 numbered lines. Each line must be exactly \`PA_CANCEL_STREAM_TOKEN <number>\`. Do not summarize or stop early.` | Open | The 30-paragraph prompt completed normally with a short answer. The 300-line prompt entered a running state, but Stop was not confirmed because Computer Use reported an invalid element / window loss and Obsidian then showed `count of windows = 0`. This is failure-to-verify, not a runtime pass. |
| 2026-05-24 | SPEC-06/SPEC-08 | `npm test -- __tests__/chat-view.test.ts --runInBand --testNamePattern cancel`; `npm test -- __tests__/pa-agent-loop.test.ts --runInBand --testNamePattern "abort\|aborted"` | Passed | Focused automated cancel/abort side evidence still passes: ChatView cancel tests passed 4 selected tests, and PaAgentLoop abort tests passed 7 selected tests. This does not close the live Obsidian cancel/recovery smoke gate. |
| 2026-05-24 | SPEC-08 Smoke | `rg -n "Error|error|Exception|Unhandled|personal-assistant|Personal Assistant|agent|runtime|TypeError|ReferenceError" "$HOME/Library/Application Support/obsidian/obsidian.log"` | Informational / open | The app log scan after the extended bundled-skill and cancel attempts produced no matches. This remains side evidence only and does not close the direct DevTools console-error gate. |
| 2026-05-24 | SPEC-08 Smoke | Obsidian recovery commands: `open -a /Applications/Obsidian.app /Users/edonyzpc/code/personal-assistant/test`; `open 'obsidian://open?vault=test&file=obsidian-operations%2Fsnippet-smoke.md'`; `open -na /Applications/Obsidian.app --args --user-data-dir=/private/tmp/pa-obsidian-smoke-profile --disable-gpu /Users/edonyzpc/code/personal-assistant/test`; System Events menu actions `Open Vault...`, `Open Recent > test`, `Window > snippet-smoke - test - Obsidian 1.12.7`, and `Bring All to Front`; `screencapture -x /private/tmp/pa-obsidian-screen.png`; `npm test -- __tests__/chat-view.test.ts --runInBand --testNamePattern cancel`; `npm test -- __tests__/pa-agent-loop.test.ts --runInBand --testNamePattern "abort\|aborted"`; `rg -n "Error|error|Exception|Unhandled|personal-assistant|Personal Assistant|agent|runtime|TypeError|ReferenceError" "$HOME/Library/Application Support/obsidian/obsidian.log"` | Open / side evidence passed | Obsidian recovery did not produce a Computer Use-readable window: System Events repeatedly returned `count of windows = 0`, Computer Use `get_app_state` timed out, and `screencapture` failed with `could not create image from display`. The two focused automated cancel/abort suites passed again: ChatView cancel 4 selected tests and PaAgentLoop abort 7 selected tests. The app log scan produced no matches, but this remains side evidence only. |
| 2026-05-24 | SPEC-06/SPEC-08 | `npm test -- __tests__/chat-view.test.ts --runInBand --testNamePattern cancel`; `npm test -- __tests__/pa-agent-loop.test.ts --runInBand --testNamePattern "abort\|aborted"`; `rg -n "Error|error|Exception|Unhandled|personal-assistant|Personal Assistant|agent|runtime|TypeError|ReferenceError" "$HOME/Library/Application Support/obsidian/obsidian.log"`; `ps -ax -o pid,ppid,comm,args \| rg -i "Obsidian\|obsidian"` | Passed / open live gates | Added the `recovers through the normal send path after a cancelled turn settles` ChatView test. Focused ChatView cancel suite now passes 5 selected tests; PaAgentLoop abort suite still passes 7 selected tests. The Obsidian app-log scan produced no matches and no Obsidian process remained after cleanup. Live cancel/recovery and direct console gates remain open because Obsidian still did not expose a readable test-vault window. |
| 2026-05-24 | SPEC-08 Smoke | Obsidian test vault live cancel/recovery prompt and direct DevTools console inspection. | Passed | Computer Use observed the long cancel prompt in the deployed Obsidian test vault ending as `CANCELLED` / `Generation cancelled`, with composer restored. The recovery prompt `After cancel recovery smoke, answer exactly PA_CANCEL_RECOVERY_OK.` returned `PA_CANCEL_RECOVERY_OK` and restored the composer. DevTools Console opened via `super+alt+i`; it showed only Obsidian Developer Console and `Settings loaded` from `plugin:personal-assistant`, with no red errors, exceptions, or issues. |
| 2026-05-24 | SPEC-08 Final closeout | `npm test -- --runInBand`; `npm run lint`; `npm run build`; `git diff --check`; `rg -n '[[:blank:]]+$' docs/pa-agent-runtime-lifecycle-plan.md docs/pa-agent-runtime-lifecycle-development-tracker.md docs/todo.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-plan.md`; `git diff --no-index --check -- /dev/null docs/pa-agent-runtime-lifecycle-development-tracker.md` | Passed | Full serialized Jest passed 43 suites / 699 tests. ESLint passed. Production build passed with the existing Browserslist stale-data warning only. Tracked whitespace check passed. The untracked runtime lifecycle doc whitespace scans produced no output; the two `--no-index` commands returned nonzero only because the files differ from `/dev/null`. |

## Risk Table

| Risk | Impact | Mitigation | Owner SPEC | Status |
| --- | --- | --- | --- | --- |
| Canonical event migration breaks legacy ChatService consumers | UI duplicate rendering or missing chunks | Adapter tests own legacy callbacks; PA runtime tests own canonical events. SPEC-06 added lifecycle ingress, canonical live-turn suppression of legacy UI callbacks, adapter metadata tests, and Obsidian smoke coverage. | SPEC-01, SPEC-06 | Mitigated |
| Loop extraction exposes too much `ChatAgentRuntime` internals | Broad, fragile dependency interface | Keep host responsibilities explicit and migrate in phases. SPEC-02 introduced a standalone loop with a narrow model/policy interface; SPEC-05 will connect host tools. | SPEC-02, SPEC-05 | Mitigated for direct-answer loop; monitor in SPEC-05 |
| HostPolicy gets mixed into lifecycle state machine | Runtime becomes hard to test and reason about | Policy hooks decide after-turn behavior; loop owns lifecycle only. SPEC-02 tests assert HostPolicy observes `turn_end` before decisions. | SPEC-02, SPEC-07 | Mitigated for HostPolicy shell; monitor in SPEC-07 |
| Idle timeout misclassifies long thinking | False failures for normal model reasoning | Reset idle on all assistant update deltas; do not cap thinking duration separately. | SPEC-03 | Mitigated for assistant deltas; monitor blocked-stream wall-clock |
| Budget stop loses partial useful output | Poor user experience | Preserve partial text with warning when available; graceful stop after turn. | SPEC-03 | Mitigated for standalone loop; monitor host/UI integration |
| Tool execution lifecycle gets stuck on errors or abort | UI remains in running state | Require paired `tool_execution_end` and toolResult for all outcomes, with 2s abort grace. | SPEC-04 | Mitigated for standalone loop; pending review and host integration |
| ToolResult transcript changes source attribution | Memory/Web/current-note citations could drift | Preserve SourceRecord and Context Used tests through SPEC-05. SPEC-06 adds canonical history/UI reconstruction tests for toolResult and host pre-context source/context metadata; SPEC-08 smoke verifies current-note, Memory, WebSearch, and SkillContext provenance. | SPEC-05, SPEC-06 | Mitigated |
| Provider web fallback remains reachable after removal decision | Web answers may bypass builtin tool audit/source ownership | Remove provider web fallback code, settings UI, persisted defaults, provider request fields, status records, tests, and source metadata paths. | SPEC-05 | Mitigated; monitor during default canonical runtime switch |
| Classifier adds latency or cost | Slower first response or unexpected provider call | 800ms timeout, dedicated lightweight policy model, deterministic fallback, privacy copy, focused timeout/error/late-result tests, and Obsidian required-capability smoke. | SPEC-07 | Mitigated |
| Required capability warnings feel like internal errors | Poor product experience | Render as UI metadata warning, not answer body text. SPEC-06 added generic warning metadata rendering and redraw tests; SPEC-07 adds classifier-produced warning metadata and no-body-copy tests; SPEC-08 verifies warning UI in Obsidian. | SPEC-06, SPEC-07 | Mitigated |
| No-tool diagnostics for WebSearch are too quiet | Users may think web search happened when the builtin tool was not used | Required WebSearch warnings explicitly identify missing/unavailable builtin WebSearch, with no provider fallback; focused runtime tests cover unavailable no-provider behavior and SPEC-08 verifies the warning UI in Obsidian. | SPEC-07 | Mitigated |
| Required capability use is falsely satisfied by toolcall intent or failed toolResult | PA could omit warning metadata even though required evidence was not actually used | Count satisfaction only from successful matching toolResult outcomes; add negative tests for toolcall-only and failed/error results. | SPEC-07 | Mitigated for focused/integrated tests; monitor Obsidian smoke |
| No-lifecycle consumers bypass canonical HostPolicy behavior during migration | Compatibility consumers may not receive required-capability classifier/corrective behavior until migrated | Keep this as an explicit compatibility-path migration gate; canonical ChatView uses `onLifecycleEvent`, while no-lifecycle consumers migrate in a later closeout slice. | SPEC-06, SPEC-08 | Accepted migration risk |
| Event identity becomes ambiguous across run-level and turn-level events | Audit/replay queries cannot reliably group or locate lifecycle records | Require non-optional raw `runId`/`turnId` on all canonical events, reserved `RUN_SCOPE_TURN_ID` for run events, delimiter-safe encoded helper keys, terminal `agent_end`, and exact `runId + turnId + seq` event key tests. | SPEC-01 | Mitigated for primitives; monitor persistence/query integration |
| Remaining smoke evidence is incomplete | Unrecorded live paths can still hide runtime/UI regressions | Require visible phase transitions and final/warning/diagnostic outcome in Obsidian smoke. Direct-answer, current-note tool, Memory, WebSearch, unsupported-warning smoke, all 7 bundled-skill cards, cancel/recovery, and direct DevTools console no-error evidence are recorded. | SPEC-08 | Closed |

## Update Rules

- When a SPEC status changes, update the SPEC Index, Phase Ledger, Review Log, and Verification Log in the same change.
- Do not mark runtime/UI SPECs `[A]` without a review record.
- Do not mark runtime/UI SPECs `[x]` without automated tests plus Obsidian smoke evidence, or an explicit deferral recorded in the tracker.
- If implementation changes product behavior in [PA Agent Architecture Plan](./pa-agent-architecture-plan.md), update that parent plan in the same change.
