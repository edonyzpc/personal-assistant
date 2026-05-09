# Project TODO

## Chat Agent Follow-ups

- [x] Extract shared Chat Agent types before adding more tools.
  - Context: `src/ai-services/chat-agent.ts` owns core result/source types while `src/ai-services/chat-tools.ts` owns the registry, so the current Phase 2A implementation has a type-level dependency in both directions.
  - Result: Shared public types now live in `src/ai-services/chat-types.ts`; `chat-agent.ts` and `chat-tools.ts` import from that module, while `chat-tools.ts` preserves type re-exports for compatibility.
  - Evidence: `npx tsc -noEmit -skipLibCheck`.

- [x] Consolidate duplicate abort helpers in Chat Agent modules.
  - Context: `isAbortError` / abort error helpers were previously duplicated across `chat-agent.ts`, `chat-tools.ts`, and `chat-service.ts`.
  - Result: Chat Agent modules now share `src/ai-services/chat-utils.ts`, and cancellation races normalize to canonical `AbortError` when the signal is already aborted.
  - Evidence: `throws canonical abort errors when a tool failure races with cancellation`.

- [ ] Consider a generic abort utility for transport helpers.
  - Context: `src/ai-services/obsidian-fetch.ts` still has local `createAbortError` / `throwIfAborted` helpers. It is a transport shim rather than Chat Agent code, so it should not import `chat-utils.ts` directly.
  - Current impact: low. Behavior is currently correct, but the duplication can be removed later by extracting a broader `abort-utils.ts` and migrating both Chat Agent and transport code.
  - Suggested commit: `refactor(ai-services): share abort helpers`

- [x] Preserve safe current-note context during planner fallback.
  - Context: Phase 2B now keeps successfully read `get_current_note_context` results when a later planner step fails; Phase 2C fallback also reuses already collected presearch Memory documents instead of starting a separate fallback Memory search.
  - Result: current-note context is preserved only after it has passed the read-only tool boundary and is wrapped as untrusted context in the final prompt.
  - Evidence: `keeps current note context when planner fallback runs after a tool observation`.

- [ ] Evaluate raw-prompt Memory presearch relevance on natural prompts.
  - Context: Phase 2C intentionally uses the user's original input as the first Memory presearch query to avoid an extra query-rewrite LLM call. This is correct for explicit or keyword-rich prompts, but long or conversational prompts may produce weaker vector matches.
  - Current impact: low to medium. Planner can still perform one supplemental `search_memory` within the per-turn Memory search budget, but poor presearch recall may make implicit note questions less reliable.
  - Observed: 2026-05-09 Obsidian test vault smoke with `我前几天好像记过一条关于 agent 安全技术演进的笔记...` did presearch first and found `2026-05-01.md`; the final stream was manually cancelled because the provider response was very slow, so this remains a multi-sample evaluation task.
  - Suggested fix: collect Obsidian smoke examples with short, long, and conversational note questions before deciding whether to add lightweight query cleanup, planner-generated supplemental query heuristics, or a configurable rewrite step.
  - Suggested commit: `test(chat-agent): evaluate presearch query relevance`

- [x] Re-evaluate ToolRegistry generic casting as tool complexity grows.
  - Context: `ToolRegistry.register` stores generic tool definitions behind an erased internal type and relies on each tool's runtime validator before execution.
  - Result: Phase 2D added three more read-only tools while keeping the registry shape stable; runtime validators still gate every execution, and tests cover unregistered tools, invalid inputs, and tool-specific success paths.
  - Evidence: `does not execute unregistered tools`; `does not execute get_current_note_context when input mode is invalid`; `executes search_vault_metadata as read-only tool context`.

- [x] Add a generic prompt path for non-Memory read-only tool context.
  - Context: Phase 2C now feeds bounded Memory presearch excerpts to the planner as `untrusted_content`; future tools may expose structured summaries or metadata with their own budgets.
  - Result: metadata search, recent notes, and note outline now use `tool-note` / `<tool_context>` with per-tool, metadata, and total context budgets; their paths are explicitly not Memory references.
  - Evidence: `executes search_vault_metadata as read-only tool context`; `keeps read-only tool paths out of memory references when memory is also used`; `truncates oversized metadata tool context to the hard budget`; `executes list_recent_notes sorted by modified time`; `executes read_note_outline for a known Markdown path`.

- [ ] Tune planner observation budgets with real mixed-tool samples.
  - Context: Phase 2D now has five read-only tools, with planner observations trimmed to `MAX_OBSERVATION_PREVIEW_CHARS` and final prompt tool notes capped by `MAX_TOOL_NOTE_CONTEXT_CHARS`.
  - Current impact: low. Automatic tests now cover hard budget truncation and long metadata query bounding; Obsidian smoke covers the individual metadata/recent/outline paths. Real notes may still reveal whether mixed-tool previews should be shorter or more structured.
  - Suggested fix: collect Obsidian mixed prompts that combine current note, metadata search, note outline, and Memory search before changing constants.
  - Suggested commit: `perf(chat-agent): tune tool observation budgets`

- [x] Bound current-note outline scanning for very large notes.
  - Context: Phase 2B uses editor line APIs for current-note reads, but `outline` mode can still scan until it finds 30 headings. In extremely large notes with few headings, that could cause a small UI pause.
  - Result: `extractHeadingsFromEditor` now caps outline scanning at 5000 editor lines, reports `outline_truncated`, `scanned_line_limit`, `total_lines`, and `max_headings`, and final current-note context keeps valid JSON under context truncation.
  - Evidence: `bounds current note outline scanning for very large notes`; `keeps current note context JSON valid when context budget truncates outline content`.

- [ ] Run Obsidian smoke for Thinking status and streaming scroll regression.
  - Context: latest Chat UI now renders one collapsible `Thinking` status block and pauses auto-scroll when the user expands details or scrolls up during streaming.
  - Current impact: medium. The code path is implemented, but this interaction is best verified in Obsidian because it depends on real streaming, DOM layout, scroll position, and user input timing.
  - Observed: 2026-05-09 Obsidian test vault smoke verified Thinking can expand during a real streaming answer and shows Memory presearch/planning details; cancelling the slow stream displayed `Generation cancelled`. The full long-output scroll-up / return-to-bottom auto-scroll cycle is still not verified.
  - Suggested validation: during a long streaming answer, expand/collapse `Thinking`, scroll to older messages, confirm the viewport is not forced to bottom, then scroll back near bottom and confirm auto-scroll resumes. Also smoke `get_current_note_context` with a large selected block, no selection inside a heading section, no active Markdown file, and an adversarial note containing `</current_note_context>` plus fake Memory references.
  - Suggested commit: `test(chat-ui): smoke test thinking scroll behavior`

- [ ] Optimize final assistant message rendering after streaming.
  - Context: `src/chat-view.ts` currently removes the streaming placeholder and calls `renderMessage(...)` again when the final assistant response completes, so the final message gets consistent formatting, copy action, and persisted rendering behavior.
  - Current impact: low. The behavior is correct, but users may notice a slight layout shift or flicker at the end of streaming.
  - Suggested fix: update the existing assistant message element in place, or split streaming content rendering from final action-button hydration so the DOM node does not need to be replaced.
  - Suggested commit: `fix(chat-ui): update final streamed message in place`

- [ ] Monitor planner fallback frequency and add recovery only if needed.
  - Context: Phase 2C fixed one real fallback cause where LangChain parsed an unescaped nested JSON example as a prompt variable. The fallback path is intentionally robust and now only reuses Memory when it came from supplemental search or passes the presearch relevance guard.
  - Current impact: low. Obsidian smoke for `agent意图安全有几个阶段？` no longer enters fallback, but frequent fallback statuses in real use would still indicate planner prompt, parser, timeout, or model-latency issues.
  - Suggested fix: collect lightweight evidence from manual smoke tests or debug logs first; if fallback is common, consider planner retry, stricter JSON repair, timeout budget tuning, or clearer planner examples.
  - Suggested commit: `fix(chat-agent): improve planner fallback recovery`

- [ ] Evaluate configurable retrieval depth for multi-hop questions.
  - Context: Phase 1 caps the planner loop at 2 retrieve steps to prevent runaway loops, bound cost/latency, and keep the first agentic retrieval release easy to reason about.
  - Current impact: low for Phase 1. Complex research questions that require "find X, then use X to find Y" may need a higher or configurable limit once Phase 2 read-only tools expand the agent's planning surface.
  - Suggested fix: keep the default at 2 until there is user feedback or smoke-test evidence; then consider a setting, per-mode budget, or tool-policy limit rather than a hard-coded global increase.
  - Suggested commit: `feat(chat-agent): configure retrieval depth budget`

- [ ] Track perceived latency after adding the planning step.
  - Context: Phase 1 adds a planner call before the final answer, and `ChatService.streamLLM` already has a small initial delay before streaming begins.
  - Current impact: low to medium. The extra step improves answer quality and selective Memory use, but may make simple questions feel slower if not monitored.
  - Suggested fix: compare simple `answer` requests against retrieval requests in the test vault, then decide whether to show earlier status feedback, reduce artificial delay, or cache planner decisions for obvious no-memory cases.
  - Suggested commit: `perf(chat-agent): reduce perceived planning latency`

## Build / Deploy Cleanup

- [ ] Remove obsolete SQLite asset cleanup from `Makefile`.
  - Context: `vss-sqlite-worker.js` and `sqlite3.wasm` are now inlined into `main.js` through esbuild (`inline-sqlite-worker` and the WASM `dataurl` loader), so standard deploy/release no longer needs standalone worker/WASM files.
  - Current impact: low. The existing `rm -rf` cleanup lines are harmless, but they are historical noise and can be removed in a separate focused change.
  - Suggested commit: `build(deploy): remove obsolete sqlite asset cleanup`

## Lifecycle Cleanup

- [ ] Disconnect the global `MutationObserver` in `src/plugin.ts` during plugin unload.
  - Context: `src/plugin.ts` creates a `MutationObserver` for `.popover.hover-popover.hover-editor` changes and observes `document.body`, but `onunload()` currently stops Memory maintenance and disposes VSS/stats without disconnecting this observer.
  - Current impact: low to medium. This is existing technical debt rather than a regression from `AGENTS.md`; however, repeated plugin reloads could leave stale observers alive.
  - Suggested fix: store the observer on the plugin instance or register a cleanup callback, then call `disconnect()` from `onunload()`.
  - Suggested commit: `fix(plugin): disconnect mutation observer on unload`
