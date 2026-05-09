# Project TODO

## Chat Agent Follow-ups

- [ ] Extract shared Chat Agent types before adding more tools.
  - Context: `src/ai-services/chat-agent.ts` owns core result/source types while `src/ai-services/chat-tools.ts` owns the registry, so the current Phase 2A implementation has a type-level dependency in both directions.
  - Current impact: low. The import is type-only and does not create a runtime cycle, but it will become harder to maintain once `get_current_note_context` and context item types land.
  - Suggested fix: move shared public types such as `ChatAgentSource`, `MemorySearchResult`, tool result types, and future context item types into a dedicated `chat-types.ts` or equivalent module before adding the next batch of Phase 2 tools.
  - Suggested commit: `refactor(chat-agent): extract shared chat types`

- [ ] Consolidate duplicate abort helpers in Chat Agent modules.
  - Context: `isAbortError` / abort error helpers now exist in `chat-agent.ts`, `chat-tools.ts`, and `chat-service.ts` so the runtime, registry, and streaming fallback can safely preserve abort semantics.
  - Current impact: low. The duplication is small and intentional for this scoped Phase 2A fix, but it should not spread as more tools are added.
  - Suggested fix: extract a tiny shared abort utility for chat-agent/tool code instead of placing it in broad AI model helpers.
  - Suggested commit: `refactor(chat-agent): share abort helpers`

- [x] Preserve safe current-note context during planner fallback.
  - Context: Phase 2B now keeps successfully read `get_current_note_context` results when a later planner step fails; Phase 2C fallback also reuses already collected presearch Memory documents instead of starting a separate fallback Memory search.
  - Result: current-note context is preserved only after it has passed the read-only tool boundary and is wrapped as untrusted context in the final prompt.
  - Evidence: `keeps current note context when planner fallback runs after a tool observation`.

- [ ] Evaluate raw-prompt Memory presearch relevance on natural prompts.
  - Context: Phase 2C intentionally uses the user's original input as the first Memory presearch query to avoid an extra query-rewrite LLM call. This is correct for explicit or keyword-rich prompts, but long or conversational prompts may produce weaker vector matches.
  - Current impact: low to medium. Planner can still perform one supplemental `search_memory` within the per-turn Memory search budget, but poor presearch recall may make implicit note questions less reliable.
  - Suggested fix: collect Obsidian smoke examples with short, long, and conversational note questions before deciding whether to add lightweight query cleanup, planner-generated supplemental query heuristics, or a configurable rewrite step.
  - Suggested commit: `test(chat-agent): evaluate presearch query relevance`

- [ ] Re-evaluate ToolRegistry generic casting as tool complexity grows.
  - Context: `ToolRegistry.register` stores generic tool definitions behind an erased internal type and relies on each tool's runtime validator before execution.
  - Current impact: low. This is acceptable for the Phase 2A MVP, but more complex tools may need stronger compile-time constraints or per-tool wrappers.
  - Suggested fix: revisit when adding the next real read-only tool beyond `search_memory` and `get_current_note_context`; avoid a broad abstraction until tool shape diversity justifies it.
  - Suggested commit: `refactor(chat-agent): tighten tool registry typing`

- [ ] Tune planner observation budgets after Current Note tool lands.
  - Context: Phase 2C now feeds bounded Memory presearch excerpts to the planner as `untrusted_content`; future tools may expose structured summaries or metadata with their own budgets.
  - Current impact: low. The right value depends on real `search_memory + get_current_note_context` mixed prompts.
  - Suggested fix: collect mixed prompt smoke evidence, then tune per-tool observation summaries and total planner observation budget.
  - Suggested commit: `perf(chat-agent): tune tool observation budgets`

- [ ] Bound current-note outline scanning for very large notes.
  - Context: Phase 2B uses editor line APIs for current-note reads, but `outline` mode can still scan until it finds 30 headings. In extremely large notes with few headings, that could cause a small UI pause.
  - Current impact: low. Typical notes should be fine, and selection / nearby reads are already bounded, but outline mode should have a defensive max scan line limit before more tools build on it.
  - Suggested fix: cap `extractHeadingsFromEditor` with a maximum scanned line count, such as 2000 or 5000 lines, and document that outline is a preview rather than exhaustive for very large notes.
  - Suggested commit: `perf(chat-agent): bound current note outline scan`

- [ ] Run Obsidian smoke for Thinking status and streaming scroll regression.
  - Context: latest Chat UI now renders one collapsible `Thinking` status block and pauses auto-scroll when the user expands details or scrolls up during streaming.
  - Current impact: medium. The code path is implemented, but this interaction is best verified in Obsidian because it depends on real streaming, DOM layout, scroll position, and user input timing.
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
