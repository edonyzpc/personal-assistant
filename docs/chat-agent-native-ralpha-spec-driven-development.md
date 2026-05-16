# Chat Agent Native Ralpha SPEC-Driven Development

## Purpose

This document drives the SPEC-first implementation of [Chat Agent Native Ralpha Loop Refactor Plan](./chat-agent-native-ralpha-loop-plan.md).

Use the Ralpha plan as the product, architecture, runtime, fallback, provider, and source-boundary contract. Use this SPEC tracker to split that contract into implementable slices, record approvals, track phase status, capture review findings, and close each phase with verification evidence.

No runtime code should be changed from this tracker until the relevant SPEC is reviewed and marked `[A] Approved for implementation`.

## Source Relationship

| Document | Role | Conflict Rule |
| --- | --- | --- |
| `docs/chat-agent-native-ralpha-loop-plan.md` | Contract source of truth for product behavior, architecture, runtime ownership, fallback, provider behavior, Memory/source boundaries, UX expectations, risk baseline, and verification baseline. | This wins for product/runtime/source-boundary decisions. |
| `docs/chat-agent-native-ralpha-spec-driven-development.md` | Active SPEC-driven implementation tracker for task slicing, execution status, review records, verification evidence, and smoke closeout. | If it drifts from the Ralpha contract, update both docs in the same reviewed change before implementation continues. |
| `docs/archive/*` Ralpha predecessor docs | Historical evidence only. | Never use as execution source unless a specific historical question requires it. |

## Status Legend

| Mark | Meaning |
| --- | --- |
| `[ ]` | Todo |
| `[D]` | Drafting |
| `[R]` | Ready for review |
| `[A]` | Approved for implementation |
| `[~]` | Implementing |
| `[T]` | Testing |
| `[V]` | Review in progress |
| `[S]` | Obsidian smoke in progress |
| `[x]` | Done |
| `[!]` | Blocked |

## SPEC Approval Gates

A SPEC may move to `[R] Ready for review` only when all of these are true:

- Contract references point to existing Ralpha headings and have been checked for drift.
- All runtime-affecting open decisions for that SPEC are resolved in the Ralpha plan, or the SPEC is explicitly marked `[!] Blocked`.
- Deliverables include implementation boundaries, expected code/test areas, source-boundary rules, and known non-goals.
- Acceptance checklist includes product behavior, runtime behavior, negative assertions, and verification commands.
- Risks that can affect the SPEC have an owner and closure condition in this tracker.

A SPEC may move to `[A] Approved for implementation` only after review records:

- reviewer or subagent review source,
- date,
- result,
- blocking findings and their disposition,
- any deferred items with owner, reason, and unblock condition.

Only non-runtime, non-dependent items may be deferred from a SPEC approval. OD-1 and OD-2 are runtime-affecting open decisions and must be resolved before SPEC-01 or SPEC-04 can move to `[A]`.

## Required Delivery Loop

Every implementation SPEC follows the repository refactor loop:

```mermaid
flowchart LR
  Spec["SPEC draft"]
  SpecReview["SPEC review"]
  Dev["dev"]
  Test["test"]
  CodeReview["review"]
  Fix["fix"]
  Deploy["make deploy"]
  Smoke["Obsidian smoke test"]
  SmokeFix["fix"]
  Done["done"]

  Spec --> SpecReview --> Dev --> Test --> CodeReview --> Fix --> Deploy --> Smoke --> SmokeFix --> Done
  Fix --> Test
  SmokeFix --> Deploy
```

Loop rules:

- SPEC review must happen before runtime implementation starts.
- Runtime/UI phases must use subagent review when the environment supports it; if unavailable, record the skip reason and residual risk.
- Runtime/UI phases require automated tests, `make deploy`, and real Obsidian test-vault smoke before completion.
- Docs-only phases may skip Obsidian smoke, but the skip and residual risk must be recorded.
- Runtime-affecting open decisions must be resolved in SPEC-00 before any dependent runtime SPEC starts. Non-runtime deferrals require an owner, reason, and unblock condition.
- SPEC status changes must update this tracker and, when contract language changes, the Ralpha plan.

## Current Status

| Field | Value |
| --- | --- |
| Created | 2026-05-14 |
| Contract source | `docs/chat-agent-native-ralpha-loop-plan.md` |
| Current stage | SPEC-06 closeout complete on `codex/ralpha-native-loop-refactor`; post-review wall-clock deadline fix implemented |
| Runtime code changes in this pass | SPEC-05 added typed timeline/event propagation, bounded Context Used attribution, completed-turn summaries, stale-event suppression tests, and UI tests while preserving strict Memory references; SPEC-06 added explicit Memory-clause initial presearch for mixed Memory plus current-note prompts and a regression test for the Obsidian smoke case. The 2026-05-17 post-review P2 fix added a turn-level 180 second wall-clock deadline around planning, rerank/native-tool waits, and final streaming. |
| Open contract decisions | 0 unresolved blocking decisions. |
| Blocked implementation areas | None. Unsupported-provider live smoke is explicitly deferred by user confirmation and covered by automated fallback tests. The post-review wall-clock live smoke is blocked by the locked macOS desktop / Computer Use timeout, not by implementation. |
| Next required action | Unlock the desktop and run a quick Obsidian smoke if live evidence is required for the wall-clock follow-up; otherwise prepare final diff review and commit packaging when requested. |

## SPEC Index

| SPEC | Goal | Status | Depends On | Primary Areas | Exit Gate |
| --- | --- | --- | --- | --- | --- |
| SPEC-00 | Resolve open decisions and capture current runtime/test baseline | `[x]` Done | None | Ralpha plan, current chat agent code, existing tests | OD-1 and OD-2 are resolved in Ralpha; only non-runtime non-dependent items may be deferred with owner/unblock criteria; baseline tests and migration risks are listed. |
| SPEC-01 | Agent-owned stream boundary | `[x]` Done | SPEC-00 | `ChatService`, `ChatAgentRuntime`, stream types, chat UI adapter | Public entry stays stable; AgentCore emits typed events; snapshot chunks and no-replay state are preserved. |
| SPEC-02 | Memory selector, LLM rerank, and hybrid expand | `[x]` Done | SPEC-00, SPEC-01 | Memory selector, VSS search, rerank prompt/schema, expander | Automated tests, subagent review, lint/build, deploy, and Computer Use Obsidian smoke passed. |
| SPEC-03 | Native read-only tool surface and tool loop | `[x]` Done | SPEC-01 | `ToolRegistry`, tool schemas, provider call normalization, transcript handling | Automated tests, subagent review/fixes, deploy, and Computer Use Obsidian smoke passed. |
| SPEC-04 | Provider fallback, no-replay, and JSON planner removal from Ralpha path | `[x]` Done | SPEC-01, SPEC-03 | provider adapters, `bindTools` probe, fallback FSM, tests | Tool-disabled pre-visible answer works; visible-after-error never replays; JSON planner is not a Ralpha fallback. |
| SPEC-05 | Expandable timeline UX and Context Used attribution | `[x]` Done | SPEC-01, SPEC-02, SPEC-04 | chat view, status/event types, styles, source rendering | Timeline events and source attribution match Ralpha UX/source-boundary contract. |
| SPEC-06 | Integration closeout and release readiness | `[x]` Done | SPEC-01 to SPEC-05 | tests, docs, deploy, Obsidian smoke | Automated tests, subagent review, `make deploy`, and Obsidian smoke all pass or have explicit deferrals. |

## Traceability Matrix

| Ralpha Contract Area | Owning SPEC | Notes |
| --- | --- | --- |
| Decision Record and open decisions | SPEC-00 | Resolve before runtime implementation. |
| Runtime Contract | SPEC-01, SPEC-04 | Stream ownership, visible state, fallback/no-replay. |
| Target Loop | SPEC-01, SPEC-02, SPEC-03, SPEC-04 | Split by event boundary, Memory selection, native tools, provider fallback. |
| Native Tool Loop and Native Tool Message Protocol | SPEC-03 | Includes current note, outline, metadata, recent notes, Memory search, tool-call normalization, and transcript rules. |
| Memory Selector And Rerank Contract | SPEC-02 | Rerank selects Memory only, can mark a native-tool context gap diagnostically, and can select none. |
| Hybrid Expand Contract | SPEC-02 | Expanded markdown inherits VSS Memory source metadata. |
| Provider And Fallback Matrix | SPEC-04 | `bindTools` probe, Qwen web search, tool-disabled fallback, no JSON planner fallback. |
| UX Event Matrix | SPEC-05 | Timeline status without hidden reasoning exposure. |
| Loop Caps | SPEC-01, SPEC-02, SPEC-03, SPEC-04 | Model-turn accounting, Memory search cap, native tool duplicate/failure caps, wall-clock cap. |
| Verification Plan | SPEC-06 | Final integrated verification and smoke closeout. |

## SPEC Detail

### SPEC-00: Closed Decisions And Baseline

Contract refs:

- Ralpha `Closed Decisions`
- Ralpha `Current Code Baseline`
- Ralpha `JSON Planner Test Migration`

Closed decisions:

- OD-1: Provider reasoning chunks count as visible output for no-replay/fallback accounting. A valid native tool call after reasoning and before any answer snapshot may execute normally, but any schema, parse, tool, model, or fallback failure after visible reasoning must emit `partial-output-error` and must not replay a replacement tool-disabled answer.
- OD-2: Tool-disabled fallback preserves the existing `qwenWebSearchEnabled` provider option. Tool-disabled means native vault tools are unavailable; provider web-search status stays separate provider/web context and never becomes a Memory source or fabricated URL citation.

Gate result:

- OD-1 and OD-2 are resolved in the Ralpha plan. SPEC-01 is unblocked and ready for review; SPEC-04 is no longer OD-blocked but still depends on SPEC-01 and SPEC-03.

Deliverables:

- Current runtime call-path inventory for `ChatService.streamLLM(...)`, `ChatAgentRuntime`, `ToolRegistry`, provider creation, and chat UI callback handling.
- Existing test inventory split into keep, migrate, rewrite, and remove.
- Final decision notes copied back into the Ralpha `Closed Decisions` section.

Required verification:

- `git diff --check`
- Read-only code/test inventory; no runtime edits.

Runtime call-path inventory:

| Area | Current Path | SPEC-00 Baseline |
| --- | --- | --- |
| UI entry | `src/chat-view.ts` `streamLLM(...)` call | UI calls `ChatService.streamLLM(...)`; `onChunk`, status, reasoning, and metadata callbacks are guarded by live-turn checks. |
| Public service API | `src/ai-services/chat-service.ts` `streamLLM(...)` | Stable public entrypoint; creates `ChatAgentRuntime` and adapts typed agent events back to the existing callbacks. |
| Agent runtime | `src/ai-services/chat-agent.ts` `ChatAgentRuntime.streamTurn(...)` / `planTurn(...)` | `streamTurn(...)` owns final streaming, cumulative snapshots, reasoning-visible no-replay, metadata, fallback, and abort terminal events; `planTurn(...)` still owns Memory presearch, planning, tool execution, and final prompt construction. |
| Tool boundary | `src/ai-services/chat-tools.ts` `ToolRegistry` | Registers and executes the five read-only tools; validates input, exports provider schemas, handles abort, and converts execution failures into recoverable tool results. |
| Provider creation | `src/ai-services/ai-utils.ts` `createChatModel(...)` | Creates Qwen/OpenAI/Ollama chat models; final stream currently uses native transport, non-stream fallback uses Obsidian transport, and Qwen thinking/web-search options come from `ChatService`. |
| UI stale/abort | `src/chat-view.ts` turn lifecycle helpers | `activeTurnId`, `AbortController`, and session checks suppress stale chunk/status/reasoning/metadata callbacks; runtime/tool code also checks `AbortSignal` where supported. |

Existing test inventory:

| Category | Current Tests | Ralpha Treatment |
| --- | --- | --- |
| Keep | Tool registry metadata/schema export, native tool call fixture parsing, provider capability matrix, provider reasoning no-replay, Qwen option construction, chat-view stale/cancel lifecycle, MemoryManager chat decisions. | Keep as foundation and expand around AgentEvent/native-loop behavior. |
| Migrate | Memory presearch/planner selection, supplemental Memory priority, read-only tools via planner actions, duplicate Memory/tool calls, skip-memory/agent-control/Answer now, vault advice policy. | Move assertions from JSON-planner decisions to selector/rerank/native tool loop/source-boundary behavior. |
| Rewrite | Unsupported native capability, invalid native args, schema export error, native planning incomplete, current-note survives planner fallback, planner parse fallback. | Rewrite to tool-disabled fallback, partial-output no-replay, and negative assertions that JSON planner is not invoked in the Ralpha path. |
| Legacy-only | Planner action parser, planner prompt JSON escaping, structured planner content, direct tool-name planner action shortcuts. | Keep only while legacy JSON planner code remains; they must not prove active Ralpha behavior. |
| Remove/quarantine after Ralpha | Native-vs-JSON planner equivalence and active JSON planner fallback integration cases. | Delete or quarantine behind explicit legacy-only describe blocks after Ralpha SPEC-04 lands. |

### SPEC-01: Agent-Owned Stream Boundary

Contract refs:

- Ralpha `Runtime Contract`
- Ralpha `Target Loop`
- Ralpha `Loop Caps`

Deliverables:

- Agent event model for search, expand, rerank, tool, web-search, answer, fallback, partial, error, and done events.
- Adapter compatibility plan so `ChatService.streamLLM(...)` remains the public entrypoint.
- Visible-output finite state machine that treats answer snapshots and provider reasoning chunks as visible.
- Abort/clear stale-event suppression rules.

Acceptance checklist:

- UI receives cumulative answer snapshots as before.
- Final metadata is emitted after the final snapshot.
- Model turn count reserves one turn for final answer.
- No-replay state is testable without relying on UI timing.

### SPEC-02: Memory Selector, Rerank, And Hybrid Expand

Contract refs:

- Ralpha `Memory Selector And Rerank Contract`
- Ralpha `Hybrid Expand`
- Ralpha `Source Attribution And Context Used`

Deliverables:

- Deterministic shortlist contract after Memory presearch.
- Rerank input/output schema that can select none, select Memory sources, or mark a native-tool context gap diagnostically.
- Bounded live markdown expansion contract with anchor-first and indexed fallback behavior.
- Source metadata preservation rules for expanded Memory windows.

Acceptance checklist:

- Rerank cannot directly emit final Memory references from current-note/tool/web paths.
- Rerank must not emit executable tool calls, bind/gate tool availability, force tool mode, or skip the native answer loop.
- `needsNativeTools` is diagnostic timeline/context-gap data only.
- Expanded content inherits shortlisted/selected VSS Memory source metadata.
- Final Memory references include only deterministic or rerank-selected Memory sources.
- Same-path current-note/tool context does not become a Memory reference unless that path was independently selected as Memory.
- If Memory selection returns none, final Memory references are empty even if current-note, vault metadata, recent-note, outline, or web context was used.
- `skip-memory` suppresses Memory search and `search_memory` native tool availability.
- Low-confidence and ambiguous shortlist cases are covered by tests.

Required verification:

- `npm test -- __tests__/chat-service.test.ts --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `git diff --check`
- Tests must cover rerank select, rerank none, `needsNativeTools` diagnostic-only output, deterministic high-confidence selection, low-confidence/ambiguous shortlist rerank, model-turn cap accounting, Memory search cap accounting, anchor-first expand, legacy no-anchor fuzzy fallback, hash mismatch, deleted/renamed file fallback, indexed fallback, and Memory-source-only metadata/reference boundaries.
- Phase closeout also requires subagent implementation review, `make deploy`, and real Obsidian test-vault smoke.

### SPEC-03: Native Read-Only Tool Surface And Tool Loop

Contract refs:

- Ralpha `Native Tool Loop`
- Ralpha `Native Tool Message Protocol`
- Ralpha `Target Loop`
- Ralpha `Source Attribution And Context Used`

Deliverables:

- Native schemas for `search_memory`, `get_current_note_context`, `search_vault_metadata`, `list_recent_notes`, and `read_note_outline`.
- Provider tool-call normalization contract.
- Serial tool execution and transcript append rules.
- Native-loop cap policy for `search_memory`, duplicate normalized calls, and repeated tool failures.
- Tool failure policy with per-tool stop-after-2-failures behavior.

Acceptance checklist:

- All read-only vault context tools are bound together when native tools are available.
- The model decides when and how to call those tools.
- Tool context can be used for answering but does not become Memory references.
- Tool results are bounded, cancellable, and safe to show in timeline details.
- `search_memory` native tool executions count against the Memory search cap; skipped `search_memory` calls while Memory is disabled do not consume the cap.
- Duplicate normalized tool name/input calls are skipped.
- Repeated failed tools stop further offers after the configured failure cap and the model answers from gathered context.
- A tool call after any non-empty answer snapshot is not executed and emits `partial-output-error` while preserving the partial answer.
- Tool-call-only provider chunks before answer/reasoning remain pre-visible for fallback accounting.

### SPEC-04: Provider Fallback And No-Replay

Contract refs:

- Ralpha `Provider And Fallback Matrix`
- Ralpha `Tool-Disabled Fallback`
- Ralpha `Loop Caps`

Deliverables:

- `bindTools` probe behavior and redacted diagnostics.
- Tool-disabled pre-visible answer path.
- Visible-after-error partial/error path.
- JSON planner non-use checks for the Ralpha path.
- Qwen web-search handling aligned with the resolved SPEC-00 decision.

Acceptance checklist:

- `bindTools` unavailable before visible output produces a tool-disabled answer.
- Schema/parse/native support failure after visible output never restarts or replays a full answer.
- Late valid tool calls after answer snapshots are treated as partial-output protocol errors, not fallback triggers.
- Provider web search is never recorded as a Memory source.
- Existing JSON planner code can remain, but Ralpha tests do not depend on it as fallback.

### SPEC-05: Timeline UX And Context Used

Contract refs:

- Ralpha `UX Event Matrix`
- Ralpha `Source Attribution And Context Used`
- Ralpha `Verification Plan`

Deliverables:

- Expandable timeline rendering for search, expand, rerank, tool, web-search, answer, fallback, partial, and loop-cap events.
- Context Used details for selected Memory, current-note, outline, metadata, recent notes, tool context, fallback/unavailable states, loop-cap states, and provider web-search status.
- Memory reference rendering that only includes selected Memory sources.
- Typed `AgentEvent` propagation to the chat view, including terminal and partial-output events that legacy status callbacks cannot express.
- Bounded Context Used metadata/summary contract that keeps Memory references separate from non-Memory context and provider status.
- Abort and clear behavior that suppresses stale chunks/events.

Acceptance checklist:

- Hidden provider reasoning is not displayed as raw reasoning text.
- User can distinguish Memory references from other context used.
- Context Used may summarize selected Memory as `Selected Memory`, but only Memory references are citations.
- Web-search status appears only as provider/web status, never as Memory, web evidence, or URL citation.
- UI remains usable during cancellation and fallback states.
- The user can see meaningful progress for Memory search, expand, rerank, native tool use, provider web-search status, fallback, partial output, and loop-cap stop.
- Tool-unavailable and fallback states are understandable and do not claim unavailable current-note, metadata, recent-note, outline, or Memory context.
- Loop-cap answers clearly indicate that they use gathered context rather than a complete tool/memory pass.
- A real mixed answer lets the user distinguish selected Memory references from current note, vault metadata, recent notes, note outline, and provider web-search context.

### SPEC-06: Integration Closeout

Contract refs:

- Ralpha `Phase Gate Baseline`
- Ralpha `Verification Plan`
- Ralpha `Verification Log`

Deliverables:

- Final automated verification record.
- Subagent review record for runtime/UI changes.
- Obsidian test-vault smoke record.
- Ralpha contract and this tracker synchronized with final implementation.

Required verification:

- Focused tests for affected chat, Memory, provider, and UI paths.
- `npm test -- --runInBand`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`
- Obsidian smoke: direct answer, current note tool, Memory plus tool mixed references, cancel/clear, web search enabled; unsupported-provider live smoke may be explicitly deferred only when automated fallback tests cover the path.

## Review Log

| Date | SPEC | Review Type | Reviewer | Result | Follow-up |
| --- | --- | --- | --- | --- | --- |
| 2026-05-14 | Setup | Docs setup | Codex | Created tracker; no runtime review yet. | Draft SPEC-00 before implementation. |
| 2026-05-14 | SPEC split | Subagent review | Product/SPEC, AI Agent/runtime, Architecture/tracker | REQUEST_CHANGES | Fixed rerank diagnostic boundary, hard SPEC-00 gates, phase status ownership, risk coverage, native-loop caps, UX acceptance, and verification evidence. |
| 2026-05-15 | SPEC-00 | Subagent + Codex review | Runtime inventory, test inventory, SPEC gate reviewers | APPROVE | OD-1 and OD-2 closed; SPEC-01 is ready for review, not auto-approved. |
| 2026-05-15 | SPEC-01 | Subagent SPEC review | Agent stream-boundary reviewer | APPROVE | No P0/P1/P2 blockers; keep public API stable and scope implementation to stream ownership/events/no-replay. |
| 2026-05-15 | SPEC-01 implementation | Subagent code/verification review | Runtime and verification reviewers | REQUEST_CHANGES -> FIXED | Fixed tracker drift, added public adapter callback-order coverage, added abort late-chunk suppression coverage. |
| 2026-05-15 | SPEC-01 implementation re-review | Subagent code/verification review | Runtime/verification reviewer | APPROVE | No remaining P2/P1/P0 findings after callback-order, abort late-chunk, and tracker fixes. |
| 2026-05-16 | SPEC-02 | Subagent SPEC review + Codex fixes | Contract/gate reviewer | REQUEST_CHANGES -> APPROVE | Fixed `Hybrid Expand` heading reference, added required verification commands and Phase 2 test coverage, and tightened Memory-source-only attribution assertions. |
| 2026-05-16 | SPEC-02 implementation | Subagent code/verification review + Codex fixes | Runtime and verification reviewers | REQUEST_CHANGES -> FIXED -> APPROVE | Fixed `search_memory` selector bypass, high-score semantic rerank, Memory search cap mismatch, and model-turn reservation so the final answer turn remains available. |
| 2026-05-16 | SPEC-02 smoke fix | Codex live smoke + regression tests + subagent follow-up | Runtime selector follow-up | FIXED -> APPROVE | Obsidian smoke exposed a ready-index Memory prompt that selected no Memory for `About.md`; fixed strong CJK lexical hit selection, retained weak-hit rerank coverage, and follow-up review approved. |
| 2026-05-16 | SPEC-03 implementation | Subagent code/verification review + Codex fixes | Native loop reviewer | REQUEST_CHANGES -> FIXED -> APPROVE | Fixed active native no-JSON-fallback behavior, disabled-Memory tool surface coverage, and late native tool-call protocol handling for keyed/unkeyed streamed chunks without misclassifying unregistered provider tool signals. |
| 2026-05-16 | SPEC-04 implementation | Subagent code/verification review + Codex fixes | Runtime and verification reviewers | REQUEST_CHANGES -> FIXED -> APPROVE | Fixed visible-reasoning late native tool-call protocol handling and tracker drift; no remaining runtime findings after review. |
| 2026-05-16 | SPEC-05 SPEC review | Subagent SPEC/UI readiness review + Codex fixes | Source-boundary and UI readiness reviewers | REQUEST_CHANGES -> FIXED -> APPROVE | Clarified Context Used as a category/status summary rather than citations, added typed event propagation and bounded Context Used metadata to deliverables, and made completed-turn summary persistence explicit. |
| 2026-05-16 | SPEC-05 implementation | Subagent code/verification review + Codex fixes | Timeline/source-boundary reviewers | REQUEST_CHANGES -> FIXED -> APPROVE | Fixed typed event propagation, Context Used metadata, completed Thinking summaries, provider web boundary prompt text, loop-cap product copy, stale metadata suppression, safe tool-running labels, and terminal typed-event handling. |
| 2026-05-16 | SPEC-06 implementation closeout | Subagent runtime/source-boundary review; subagent docs/verification review; targeted P2 follow-up review; Codex smoke fixes | Runtime/source-boundary and docs/verification reviewers | REQUEST_CHANGES -> FIXED -> APPROVE | Fixed unsupported-provider deferral tracking, mixed Memory plus current-note presearch, and `Memory references` format-instruction exclusion. The mixed prompt now searches with the explicit Memory clause before native current-note answering, and Obsidian smoke passed after redeploy/reload. |
| 2026-05-17 | SPEC-06 post-review wall-clock cap finding | Review finding analysis + Codex runtime fix | Runtime cap reviewer | REQUEST_CHANGES -> FIXED | Added turn-level wall-clock deadline enforcement after review found the documented 180 second cap was not enforced at runtime. Tests now cover hung Memory rerank and hung final stream after visible output. |

## Verification Log

| Date | Scope | Command / Method | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-14 | Docs setup | `git diff --check -- docs/chat-agent-native-ralpha-loop-plan.md`; `rg -n "[[:blank:]]+$" docs/chat-agent-native-ralpha-loop-plan.md docs/chat-agent-native-ralpha-spec-driven-development.md` | Passed | Docs-only setup; no runtime code changed. |
| 2026-05-14 | SPEC review fixes | `git diff --check -- docs/chat-agent-native-ralpha-loop-plan.md`; `rg -n "[[:blank:]]+$" docs/chat-agent-native-ralpha-loop-plan.md docs/chat-agent-native-ralpha-spec-driven-development.md`; targeted stale-contract scan | Passed | Ralpha/SPEC tracker consistency and whitespace validated after review fixes. |
| 2026-05-15 | SPEC-00 call-path inventory | Read-only scan of `src/chat-view.ts`, `src/ai-services/chat-service.ts`, `src/ai-services/chat-agent.ts`, `src/ai-services/chat-tools.ts`, and `src/ai-services/ai-utils.ts` | Passed | Confirmed current stream owner is `ChatService`; runtime owns planning/tool prompt construction only. |
| 2026-05-15 | SPEC-00 test inventory | Read-only scan of `__tests__/chat-service.test.ts`, `__tests__/chat-view.test.ts`, `__tests__/memory-manager.test.ts`, provider/settings tests | Passed | Classified existing tests into keep, migrate, rewrite, legacy-only, and remove/quarantine categories. |
| 2026-05-15 | SPEC-00 docs verification | `git diff --check`; `rg -n "[[:blank:]]+$" docs/chat-agent-native-ralpha-loop-plan.md docs/chat-agent-native-ralpha-spec-driven-development.md` | Passed | No whitespace errors or trailing whitespace after SPEC-00 doc edits. |
| 2026-05-15 | SPEC-01 approval gate | Subagent review of Ralpha stream/event contract and current runtime/UI boundaries | Passed | Approved for implementation with scope limited to agent-owned streaming, typed events, visible-output FSM, and adapter compatibility. |
| 2026-05-15 | SPEC-01 focused tests | `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand` | Passed | 150 tests passed; covers runtime typed snapshots, public adapter callback order, reasoning-visible no-replay, pre-visible fallback, abort late-chunk suppression, Qwen option preservation, and existing chat UI stale/cancel behavior. |
| 2026-05-15 | SPEC-01 typecheck | `npx tsc -noEmit -skipLibCheck` | Passed | Stream ownership move typechecked after implementation and review fixes. |
| 2026-05-15 | SPEC-01 whitespace | `git diff --check` | Passed | No whitespace errors after implementation and review fixes. |
| 2026-05-15 | SPEC-01 deploy gate | `make deploy` | Passed | Full Jest suite passed (21 suites, 288 tests), lint passed, build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`. |
| 2026-05-16 | SPEC-01 branch deploy gate | `make deploy` on `codex/ralpha-native-loop-refactor` | Passed | Full Jest suite passed (21 suites, 288 tests), lint passed, build passed, and plugin assets were copied into the test vault with `main.js`, manifests, and styles timestamped 2026-05-16 18:49. |
| 2026-05-16 | SPEC-01 manual smoke confirmation | User-run Obsidian smoke in `test` vault on `codex/ralpha-native-loop-refactor` | Passed | App was reloaded; current-note prompt completed; cancel smoke passed; no console errors reported. |
| 2026-05-16 | SPEC-02 focused runtime tests | `npm test -- __tests__/chat-service.test.ts --runInBand` | Passed | 112 tests passed; covers shortlist grouping, rerank select/none, `needsNativeTools` diagnostic-only behavior, hybrid expand fallback, Memory-source-only references, Memory search cap, final-answer turn reservation, rerank failure/abort behavior, strong CJK lexical selection, and weak lexical rerank. |
| 2026-05-16 | SPEC-02 focused UI/runtime tests | `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand` | Passed | 165 tests passed; includes Memory rerank/selected/expanded status text, source bar rendering, and runtime selector coverage. |
| 2026-05-16 | SPEC-02 lint/typecheck/whitespace | `npm run lint`; `npx tsc -noEmit -skipLibCheck`; `git diff --check` | Passed | No lint, TypeScript, or whitespace errors after review fixes. |
| 2026-05-16 | SPEC-02 deploy gate | `make deploy` | Passed | Full Jest suite passed (21 suites, 303 tests), lint passed, build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`. |
| 2026-05-16 | SPEC-03 focused runtime tests | `npm test -- __tests__/chat-service.test.ts --runInBand` | Passed | 122 tests passed; adds streamed native tool-call chunk merging, missing-id/index and missing-id/no-index chunk continuation, duplicate native tool skip-and-continue, repeated native tool failure cap, disabled-Memory native surface, no JSON planner call for unsupported/schema/parse native paths, and late native tool-call partial-output errors for complete/keyed/unkeyed streamed chunks. |
| 2026-05-16 | SPEC-03 focused UI/runtime tests | `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand` | Passed | 175 tests passed; native-loop runtime changes did not regress chat UI status/source rendering coverage. |
| 2026-05-16 | SPEC-03 lint/typecheck/whitespace | `npm run lint`; `npx tsc -noEmit -skipLibCheck`; `git diff --check` | Passed | No lint, TypeScript, or whitespace errors after the SPEC-03 native-loop changes. |
| 2026-05-16 | SPEC-03 full regression | `npm test -- --runInBand` | Passed | 21 suites and 313 tests passed after late native tool-call protocol fixes. |
| 2026-05-16 | SPEC-03 deploy gate | `make deploy` | Passed | Full Jest suite passed (21 suites, 313 tests), lint passed, build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`. |
| 2026-05-16 | SPEC-04 focused runtime tests | `npm test -- __tests__/chat-service.test.ts --runInBand` | Passed | 128 tests passed; covers `bindTools` missing/throws, schema export failure, native parse failure, tool-disabled fallback prompts, JSON planner non-use for Ralpha fallback paths, provider web-search not entering Memory metadata, and visible reasoning/answer no-replay protocol errors. |
| 2026-05-16 | SPEC-04 focused UI/runtime tests | `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand` | Passed | 181 tests passed; runtime fallback/no-replay changes did not regress chat UI status/source rendering coverage. |
| 2026-05-16 | SPEC-04 lint/typecheck/whitespace | `npm run lint`; `npx tsc -noEmit -skipLibCheck`; `git diff --check` | Passed | No lint, TypeScript, or whitespace errors after SPEC-04 fixes. |
| 2026-05-16 | SPEC-04 full regression | `npm test -- --runInBand` | Passed | 21 suites and 319 tests passed after provider fallback/no-replay fixes. |
| 2026-05-16 | SPEC-04 deploy gate | `make deploy` | Passed | Full Jest suite passed (21 suites, 319 tests), lint passed, build passed, and plugin assets were copied into `test/.obsidian/plugins/personal-assistant/`. |
| 2026-05-16 | SPEC-05 focused UI tests | `npm test -- __tests__/chat-view.test.ts --runInBand` | Passed | Covers completed Thinking summary persistence, raw provider reasoning hiding, Context Used rendering, stale metadata suppression after cancel, safe tool-running labels, partial-output terminal event handling, and raw-path negative assertions. |
| 2026-05-16 | SPEC-05 focused runtime tests | `npm test -- __tests__/chat-service.test.ts --runInBand` | Passed | Covers typed `AgentEvent` propagation, Context Used metadata construction, Memory-only source boundary, provider web-search status boundary, fallback/no-replay behavior, and loop-cap status mapping. |
| 2026-05-16 | SPEC-05 focused UI/runtime tests | `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand` | Passed | Combined focused suites passed after review fixes. |
| 2026-05-16 | SPEC-05 lint/typecheck/whitespace | `npm run lint`; `npx tsc -noEmit -skipLibCheck`; `git diff --check` | Passed | No lint, TypeScript, or whitespace errors after SPEC-05 review fixes. |
| 2026-05-16 | SPEC-05 full regression | `npm test -- --runInBand` | Passed | 21 suites and 322 tests passed after timeline and Context Used changes. |
| 2026-05-16 | SPEC-05 build/deploy gate | `npm run build`; `make deploy` | Passed | Build passed, and `make deploy` reran tests/lint/build before copying plugin assets into `test/.obsidian/plugins/personal-assistant/`. |
| 2026-05-16 | SPEC-06 initial final deploy gate | `make deploy` | Passed | Initial final deploy gate passed with 21 suites and 322 tests, lint, build, and plugin assets copied into `test/.obsidian/plugins/personal-assistant/`. Subsequent mixed smoke exposed an initial Memory presearch query issue, fixed below. |
| 2026-05-16 | SPEC-06 final review and post-fix checks | Subagent runtime/source-boundary review; subagent docs/verification review; `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check` | Passed | Runtime/source-boundary review found no P0/P1/P2 issues. Docs review found one P2 plan/tracker sync gap for the unsupported-provider live-smoke deferral, which was fixed in the Ralpha plan. Focused UI/runtime tests passed with 184 tests; typecheck, lint, and whitespace checks passed before the mixed-presearch smoke fix. |
| 2026-05-16 | SPEC-06 mixed-presearch smoke fix | `npm test -- __tests__/chat-service.test.ts --runInBand`; `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `git diff --check`; `make deploy` | Passed | Added explicit Memory-clause initial presearch for mixed Memory plus current-note prompts and excluded `Memory references` format-only segments from the initial Memory query. `chat-service` passed with 129 tests, focused UI/runtime passed with 185 tests, typecheck and whitespace passed, and `make deploy` passed with 21 suites and 323 tests, lint, build, and asset copy. |
| 2026-05-17 | SPEC-06 wall-clock deadline post-review fix | `npm test -- __tests__/chat-service.test.ts --runInBand`; `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts --runInBand`; `npx tsc -noEmit -skipLibCheck`; `git diff --check`; `make deploy` | Passed | Added the missing turn-level 180 second wall-clock deadline. `chat-service` passed with 131 tests, focused UI/runtime passed with 187 tests, typecheck and whitespace passed, and `make deploy` passed with 21 suites / 325 tests, lint, build, and asset copy. |

## Obsidian Smoke Log

| Date | SPEC / Phase | Build | Smoke Scenario | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-05-14 | Docs setup | Not applicable | Not applicable | Skipped | Docs-only setup; no runtime/UI behavior changed. |
| 2026-05-15 | SPEC-00 | Not applicable | Not applicable | Skipped | Docs-only decision and baseline gate; runtime/provider behavior remains unvalidated until runtime SPEC implementation plus `make deploy` smoke. |
| 2026-05-15 | SPEC-01 | `make deploy` | Open `0.unsorted/Dog.md` in the `test` vault and run the Personal Assistant chat command through Obsidian Advanced URI. | Partial | Obsidian processed both URIs and the workspace state confirms `sidellm-view` with title `Personal Assistant Chat`; Computer Use timed out and `screencapture` failed, so no live prompt submission was observed. |
| 2026-05-16 | SPEC-01 | `make deploy` on `codex/ralpha-native-loop-refactor` | Reload Obsidian through Advanced URI, open `0.unsorted/Dog.md`, open Personal Assistant Chat, and attempt live UI inspection. | Partial | Obsidian processed reload/open-chat URIs and `test/.obsidian/workspace.json` confirms `sidellm-view` with title `Personal Assistant Chat`; Computer Use timed out for both `Obsidian` and `md.obsidian`, so no live prompt submission was observed. |
| 2026-05-16 | SPEC-01 | `make deploy` on `codex/ralpha-native-loop-refactor` | Manual live chat smoke in the `test` vault after app reload: current-note prompt and cancel behavior. | Passed | User confirmed current-note prompt completed, cancel smoke passed, and no console errors were observed. |
| 2026-05-16 | SPEC-02 | `make deploy` on `codex/ralpha-native-loop-refactor` | Computer Use live chat smoke in the `test` vault: long answer no longer fails during rerank, cancel works, current-note prompt answers from `Dog.md`, and Memory prompt retrieves `About.md`. | Passed | Obsidian reloaded; Console stayed at `0 messages in console`; Memory prompt `根据我的 Memory，周至今天安排了去哪里玩？请给出 Memory references。` answered `西溪湿地公园`, displayed `Memory used (1)`, and expanded to source `About.md`. |
| 2026-05-16 | SPEC-03 | `make deploy` on `codex/ralpha-native-loop-refactor` | Computer Use live chat smoke in the `test` vault after app reload: current-note prompt asks what speed `Dog.md` says dogs can fly at low altitude. | Passed | Answer completed and cited `2000km/h`; Thinking reached complete state; Console stayed at `0 messages in console`. The Memory badge showed `Memory needs update`, but the current-note native path completed without Memory preparation. |
| 2026-05-16 | SPEC-04 | `make deploy` on `codex/ralpha-native-loop-refactor` | Computer Use live chat smoke in the `test` vault after app reload: current-note native answer and direct no-vault answer. | Passed | Current-note prompt completed and cited `2000km/h`; direct `HTTP 404` prompt completed in one sentence; both turns reached Thinking complete; Console stayed at `0 messages in console`. |
| 2026-05-16 | SPEC-05 stale-runtime check | `make deploy` on `codex/ralpha-native-loop-refactor` before Obsidian reload | Initial Computer Use smoke expanded a Thinking row from the already-loaded old bundle. | Invalid setup | The stale pre-reload UI still showed raw `MODEL THINKING` and raw `0.unsorted/Dog.md`; this was not counted as SPEC-05 validation and forced an app reload before final smoke. |
| 2026-05-16 | SPEC-05 | `make deploy` on `codex/ralpha-native-loop-refactor` after Obsidian reload | Computer Use live chat smoke in the `test` vault: current-note prompt asks for the low-altitude dog flight speed, then expands Thinking details. | Passed | Answer completed with `2000km/h`; Thinking stayed visible as `Thinking complete`; expanded details showed Assistant Activity, Context Used, safe current-note label `Dog`, provider web-search status only, and hidden-provider-thinking notice. It did not show raw `MODEL THINKING` or raw note paths, and Console stayed at `0 messages in console`. |
| 2026-05-16 | SPEC-06 | `make deploy` on `codex/ralpha-native-loop-refactor` after Obsidian reload | Computer Use integrated smoke in the `test` vault: direct answer, current-note/Memory attribution, Memory-only reference, cancel recovery, clear-chat, and mixed Memory plus current-note prompt. | Passed | Direct answer completed with HTTP 404 explanation and Thinking complete. Cancel recovery worked twice with `CANCELLED / Generation cancelled`, composer restored, and Console stayed at `0 messages in console`. Current-note prompt completed with `2000km/h`, Thinking complete, safe current-note label `Dog`, hidden provider reasoning, and no console errors. Memory-only prompt answered `西溪湿地公园`, showed `Memory used (1)`, and expanded to `Selected Memory` -> `About`. Clear-chat passed after explicit user confirmation: chat emptied to the empty state, composer was empty, toast showed `Chat cleared`, and Console stayed at `0 messages in console`. After the mixed-presearch fix and redeploy/reload, mixed prompt answered the Memory subquestion with `西溪湿地公园`, answered the current-note subquestion with `2000km/h`, showed `Memory used (1)`, and expanded Context Used to `Selected Memory` -> `About` / `Eligible for Memory references`, `Current note` -> `Dog` / `Not a Memory reference`, and provider web-search `Status only`. Unsupported-provider live smoke is explicitly deferred by user confirmation and covered by automated fallback tests. |
| 2026-05-16 | SPEC-06 post-review P2 fix | `make deploy` on `codex/ralpha-native-loop-refactor` after Obsidian reload | Computer Use sanity smoke in the `test` vault after the `Memory references` format-instruction exclusion fix. | Passed with automated exact-case coverage | The exact mixed prompt containing `请使用 Memory references 格式输出` is covered by Jest because the live provider final stream did not complete and was cancelled with Console at `0 messages in console`. The same redeployed bundle then passed Memory-only source smoke: answer `西溪湿地公园`, `Memory used (1)`, expanded `Selected Memory` -> `About`, and Console stayed at `0 messages in console`. |
| 2026-05-17 | SPEC-06 wall-clock deadline post-review fix | `make deploy` on `codex/ralpha-native-loop-refactor`; Obsidian URI / Computer Use attempt | Smoke the redeployed bundle after adding runtime wall-clock enforcement. | Blocked | Obsidian reload URI processed, but the desktop was locked. Computer Use timed out reading both `Obsidian` and `md.obsidian`; screenshot confirmed the macOS lock screen. No chat prompt was submitted, and this live smoke is not counted as passed. Exact hung-rerank and final-stream deadline behavior is covered by automated tests. |

## Risk Register

| Risk | Impact | Mitigation | Owner SPEC | Status |
| --- | --- | --- | --- | --- |
| Open decisions leak into runtime implementation | Implementation could encode unreviewed fallback semantics. | Resolve OD-1 and OD-2 in SPEC-00 before code. | SPEC-00 | Closed on 2026-05-15. |
| Agent-owned streaming breaks existing UI callback assumptions | UI could receive deltas/metadata in an order it cannot handle. | Preserve snapshot callback semantics; test metadata ordering, stale suppression, and no-replay state. | SPEC-01 | Closed on 2026-05-16. |
| JSON planner tests accidentally preserve the old fallback path | Ralpha path could remain planner-dependent. | Inventory tests and rewrite Ralpha-specific expectations in SPEC-00/SPEC-04. | SPEC-00, SPEC-04 | Closed on 2026-05-16; unsupported capability, `bindTools` missing/throwing, schema export failure, and native parse failure assert tool-disabled fallback and no JSON planner model call. |
| Native tool loop misinterprets provider-specific tool-call shapes | Tool calls could execute with wrong ids, order, inputs, or visibility state. | Normalize provider fields before execution; test ids, serial order, parse failures, and late tool-call errors. | SPEC-03, SPEC-04 | Closed on 2026-05-16; SPEC-03 covered provider shape normalization and SPEC-04 covered bind/probe fallback plus visible-reasoning/answer no-replay protocol errors. |
| Rerank becomes a hidden planner again | The selector could drive tool execution instead of only selecting Memory. | Keep `needsNativeTools` diagnostic-only and add negative tests that rerank cannot emit executable tool decisions. | SPEC-02 | Closed for SPEC-02 on 2026-05-16. |
| Rerank selects unrelated Memory | Final answers could cite irrelevant notes as Memory. | Structured rerank output, deterministic strong lexical selection, select-none tests, explicit Memory-clause presearch for mixed prompts, `Memory references` format-instruction exclusion, and no Memory references without selected sources. | SPEC-02, SPEC-05, SPEC-06 | Closed on 2026-05-16. Memory-only smoke selected `About`; mixed live prompt selected `About` for Memory, kept current-note `Dog` as `Not a Memory reference`, and answered both subquestions after the SPEC-06 mixed-presearch fix. |
| Tool context is mistaken for Memory references | User-facing citations could become misleading. | Enforce source-boundary checks in SPEC-02/SPEC-05. | SPEC-02, SPEC-05 | Final review passed on 2026-05-16. Current-note Context Used smoke showed `Not a Memory reference`; mixed prompt boundary passed. |
| Hybrid expand leaks non-Memory paths into references | Live-read file paths could become false Memory sources. | Expanded content must inherit VSS source metadata; unanchorable live reads fall back to indexed chunks. | SPEC-02, SPEC-05 | Final review passed on 2026-05-16; raw-path guard and safe Context Used labels passed automated and live checks. |
| Provider web search attribution is ambiguous | Web context could be shown as Memory or vault evidence. | Keep provider web status and Context Used separate from Memory references. | SPEC-04, SPEC-05 | Final review passed on 2026-05-16; provider web-search appears as status only in Context Used. |
| Diagnostics store sensitive content | Prompt, note body, path, or transcript content could leak into logs. | Require redacted diagnostics only and verify no prompt body, note body, raw path, or transcript is recorded. | SPEC-04, SPEC-06 | Final review passed on 2026-05-16; no new diagnostics issue found in runtime/source-boundary review. |
| Abort/clear races produce stale chunks or timeline events | UI could show results from a cancelled turn. | Specify and test turn identity suppression in SPEC-01/SPEC-05. | SPEC-01, SPEC-05 | Closed on 2026-05-16. Cancel smoke, stale-event tests, and live clear-chat smoke passed after explicit user confirmation. |
| Loop caps produce low-quality answers | Agent may stop before ideal context is collected, or could previously run indefinitely if a rerank/native tool/final stream hung. | Reserve final model turn, enforce Memory/tool caps, race the turn against a 180 second wall-clock deadline, and answer from gathered context or preserve partial output with visible cap status. | SPEC-01, SPEC-03, SPEC-04, SPEC-05, SPEC-06 | Closed by the 2026-05-17 post-review fix. Automated tests cover hung rerank and final-stream deadline paths; `make deploy` passed. Live Obsidian smoke for this follow-up is blocked by the locked desktop and not counted as passed. |

## Update Rules

- Keep this tracker as the only active SPEC execution tracker for the Ralpha iteration.
- When a SPEC moves status, update the SPEC Index, Review Log, and Verification Log in the same change.
- When implementation changes contract behavior, update the Ralpha plan first and trace the change back here.
- When tests or smoke checks are skipped, record the reason and residual risk.
- Commit links or hashes should be added to the relevant SPEC row after implementation commits are created.
