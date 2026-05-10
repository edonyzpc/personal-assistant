# Project TODO

## Future Milestones

- [ ] Review and scope write action / command execution product and security design.
  - Context: the `PLAN.md` refactor track closed through Phase 6 with Chat still read-only. Future write actions and Obsidian command execution must not be implemented by weakening the current read-only tool boundary.
  - Source docs: `docs/PLAN.md`; `docs/write-action-design-handoff.md`; `docs/vault-native-assistant-development-tracker.md`.
  - Entry criteria: define the first action family, allowed targets, preview / confirm UX, cancellation behavior, local-only redacted audit policy, permission settings, and rollback / failure handling.
  - Exit criteria: product/security review explicitly approves an implementation plan, creates a separate development tracker, and keeps direct note writes, arbitrary filesystem edits, shell/bash, and automatic Obsidian command execution out of scope unless separately approved.

## Completed Priority Items

- [x] Run Obsidian smoke for Thinking status and streaming scroll regression.
  - Context: latest Chat UI renders one collapsible `Thinking` status block and pauses auto-scroll when the user expands details or scrolls up during streaming.
  - Result: 2026-05-10 Obsidian test vault smoke verified `Thinking` expands during active streaming. A 220-line streamed response continued while the Chat viewport was moved away from the bottom with `PageUp`, and the viewport was not forced back to the latest chunk. Returning to the bottom with `End` showed the final rendered response and normal action-button state.
  - Evidence: `make deploy`; Obsidian 1.12.7 test vault smoke.

- [x] Disconnect the global `MutationObserver` in `src/plugin.ts` during plugin unload.
  - Context: `src/plugin.ts` creates a `MutationObserver` for `.popover.hover-popover.hover-editor` changes and observes `document.body`.
  - Result: the observer is now stored on the plugin instance, disconnected in `onunload()`, and cleared after unload so repeated plugin reloads do not keep stale observers alive.
  - Evidence: `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `git diff --check`.

## Completed Historical Follow-ups

- [x] Extract shared Chat Agent types before adding more tools.
  - Result: shared public types live in `src/ai-services/chat-types.ts`; `chat-agent.ts` and `chat-tools.ts` import from that module, while `chat-tools.ts` preserves type re-exports for compatibility.
  - Evidence: `npx tsc -noEmit -skipLibCheck`.

- [x] Consolidate duplicate abort helpers in Chat Agent modules.
  - Result: Chat Agent modules share `src/ai-services/chat-utils.ts`, and cancellation races normalize to canonical `AbortError` when the signal is already aborted.
  - Evidence: `throws canonical abort errors when a tool failure races with cancellation`.

- [x] Preserve safe current-note context during planner fallback.
  - Result: current-note context is preserved only after it has passed the read-only tool boundary and is wrapped as untrusted context in the final prompt.
  - Evidence: `keeps current note context when planner fallback runs after a tool observation`.

- [x] Re-evaluate ToolRegistry generic casting as tool complexity grows.
  - Result: Phase 2D added more read-only tools while keeping the registry shape stable; runtime validators still gate every execution.
  - Evidence: `does not execute unregistered tools`; `does not execute get_current_note_context when input mode is invalid`; `executes search_vault_metadata as read-only tool context`.

- [x] Add a generic prompt path for non-Memory read-only tool context.
  - Result: metadata search, recent notes, and note outline use `tool-note` / `<tool_context>` with per-tool, metadata, and total context budgets.
  - Evidence: `executes search_vault_metadata as read-only tool context`; `keeps read-only tool paths out of memory references when memory is also used`; `truncates oversized metadata tool context to the hard budget`; `executes list_recent_notes sorted by modified time`; `executes read_note_outline for a known Markdown path`.

- [x] Bound current-note outline scanning for very large notes.
  - Result: `extractHeadingsFromEditor` caps outline scanning at 5000 editor lines and reports truncation metadata.
  - Evidence: `bounds current note outline scanning for very large notes`; `keeps current note context JSON valid when context budget truncates outline content`.

## Archived Observations

These items are intentionally not tracked as active TODOs. Reopen one only when new bug reports, repeated smoke-test evidence, or a release gate makes it necessary.

### Chat Agent

- Generic abort utility for transport helpers: `src/ai-services/obsidian-fetch.ts` still owns local abort helpers. Current behavior is correct, and this is only low-risk duplication.
- Raw-prompt Memory presearch relevance: keep observing natural prompts before adding query cleanup or a rewrite step.
- Planner observation budgets: current tests cover hard budget truncation; tune only if real mixed-tool prompts show poor output or excess latency.
- Final assistant message rendering after streaming: current remove/re-render path is correct; optimize only if users notice visible flicker.
- Planner fallback frequency: collect evidence first; add retry or repair logic only if fallback becomes common.
- Configurable retrieval depth: keep the default capped behavior until multi-hop user feedback justifies a setting.
- Perceived planning latency: monitor simple prompts versus retrieval prompts before changing status timing, delay, or caching.

### Build / Deploy

- Obsolete SQLite asset cleanup in `Makefile`: the cleanup lines are harmless historical noise because worker/WASM assets are now inlined into `main.js`.
