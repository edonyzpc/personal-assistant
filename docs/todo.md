# Project TODO

## Chat Agent Follow-ups

- [ ] Optimize final assistant message rendering after streaming.
  - Context: `src/chat-view.ts` currently removes the streaming placeholder and calls `renderMessage(...)` again when the final assistant response completes, so the final message gets consistent formatting, copy action, and persisted rendering behavior.
  - Current impact: low. The behavior is correct, but users may notice a slight layout shift or flicker at the end of streaming.
  - Suggested fix: update the existing assistant message element in place, or split streaming content rendering from final action-button hydration so the DOM node does not need to be replaced.
  - Suggested commit: `fix(chat-ui): update final streamed message in place`

- [ ] Monitor planner fallback frequency and add recovery only if needed.
  - Context: Phase 1 falls back when planner JSON parsing or the low-temperature non-streaming planning call fails. The fallback path is intentionally robust and still answers by reusing the final prompt builder with ready memory results when available.
  - Current impact: low. This is acceptable for Phase 1, but frequent fallback statuses would indicate planner prompt, parser, timeout, or model-latency issues.
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
