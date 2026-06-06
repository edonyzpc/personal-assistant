# Project TODO

## Active Release Gates

- [x] Close Pagelet beta workbench completion before release planning.
  - Context: Pagelet's current beta path is intentionally continuing toward the original workbench interaction model before any release work. The provider structured-output matrix was initially deferred by product decision, then resumed and passed after the core desktop workbench smoke.
  - Result: Pagelet panel opens without provider calls; local scope selection and manual include/skip toggles work; current-note review reaches the configured provider; preview confirmation writes `.pagelet/*.md`; Accept/Draft edit/restore/Remove work; source and related-note chips work; Research pre-fills Chat without auto-submit; non-Markdown view triggers are safe no-ops; Reduce motion suppresses or visibly reduces mascot animation; provider structured-output matrix passed; mobile smoke passed; real screen-reader smoke passed; AI-plugin coexistence smoke passed.
  - Evidence: `docs/pagelet-smoke-checklist.md`; `docs/pagelet-next-work-plan.md`; focused Pagelet tests including `__tests__/pagelet-view.test.ts`; desktop test-vault Smoke 1-5 passed; provider matrix follow-up passed; mobile smoke passed; VoiceOver smoke passed; AI-plugin coexistence smoke passed.
  - Follow-ups: no remaining Pagelet smoke follow-up in this gate. This closeout does not start release/publish flow.
  - Exit criteria: Workstream A in `docs/pagelet-next-work-plan.md` is implemented and smoke-verified, docs match actual behavior, and no release/publish flow starts until Pagelet beta functionality is complete.

- [ ] Close v2 review follow-up stabilization before release.
  - Context: 2026-05-30 code-led status reconciliation shows the original v2 review plan was only partially implemented. Current code instead prioritized Settings/Keychain safety, API Token UX, Chat history modal cleanup, and VSS/Memory OPFS-lock recovery.
  - Completed so far: API token migration clears `data.json`; scoped/legacy keychain fallback is in place; API Token editor/clear confirmation works; provider switching confirms preset replacement; Settings data-safety fixes are covered by tests; chat history modal overflow/duplicate preview issues are fixed; chat history persistence exists in IndexedDB-backed store/manager code; chat-tools split, statistics incremental snapshot cache, WASM lazy load, and RequiredCapability refactor are implemented; foreground OPFS marker recovery is removed and manual technical recovery is bounded.
  - Evidence so far: focused VSS/SQLite tests passed; full serialized Jest passed 51 suites / 864 tests; `npm run lint`; `npm run build`; `git diff --check`; `make deploy`; Obsidian test-vault `Update memory now` smoke completed with Memory diagnostics Ready and notes unchanged.
  - Remaining decisions: accept/defer open original v2 Phase 1-2 items (`prompt` lines, `getVSSFiles()` optimization, strict mode, coverage threshold, rerank excerpt length, prompt token de-dup, chat-history sandbox, catalog simplification, rewrite+embedding parallelization) and the full Settings IA/componentization follow-up before cutting a release.
  - High-risk smoke completed in the 2026-05-30 conversation after explicit confirmation: `Update plugins`, `Update themes`, AI Featured Images, and actual Memory reset/delete-old-cache execution.
  - Exit criteria: status docs stay aligned with code, and open v2 items are explicitly accepted/deferred or implemented before release.

- [x] Fix structured vault tool argument extraction exposed by broad PA Agent desktop smoke.
  - Context: 2026-05-24 Computer Use smoke in the Obsidian `test` vault passed core PA Agent paths but found that several structured read tools can be selected while required model-provided arguments are lost before execution.
  - Result: host tool normalization now repairs omitted `query` / `path` inputs for `search_vault_snippets`, `search_vault_metadata`, `read_note_outline`, `read_canvas_summary`, and path-specific `inspect_obsidian_note`; successful `inspect_obsidian_note` also satisfies current-note required-capability policy to avoid the false warning.
  - Evidence: focused host/policy tests passed 34 tests; adjacent runtime/operation tests passed 98 tests; `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `make deploy` passed 44 suites / 723 tests plus lint/build and copied assets into the local `test` vault. Targeted Computer Use smoke in Obsidian passed snippets, metadata, outline, canvas, path-specific note inspection, and current-note warning re-check.
  - Source docs: `docs/pa-agent-design-completion-audit.md`.
  - Exit criteria: schema-aware argument extraction/repair coverage exists for required string tool fields, live path/query propagation is fixed, and targeted Obsidian smoke passed for snippets, metadata, outline, canvas, path-specific note inspection, and current-note inspect warning.

- [x] Close PA Agent v1 development release gates.
  - Context: the runtime lifecycle tracker is complete, and the broader PA Agent development tracker owns mobile platform evidence, independent review, and telemetry baseline closeout.
  - Result: desktop Obsidian smoke evidence is complete for direct answer, current-note tool, Memory, builtin WebSearch, unsupported warning UI, bundled skills, cancel/recovery, and DevTools console no-error inspection. Desktop Obsidian mobile-emulation smoke is complete for PA Chat load, direct answer, and the historical mobile WebSearch-unavailable warning path. Real iPhone smoke recorded a cold-start sample plus core chat/direct answer, current-note retry success, current-note-only full-context exact token lookup, historical mobile WebSearch-unavailable behavior, mobile WebSearch success after API-key entitlement fix, mobile WebSearch no-memory warning re-smoke, mobile WebSearch ordinary recovery, mobile WebSearch cancel/recovery, and general cancel/recovery. The iPhone-found false WebSearch-required warning, non-current-note tool drift, insufficient current-note context, duplicate-tool empty-answer, mobile WebSearch 403 diagnostic, and no-memory false-warning issues now have code-level regression coverage and passed real-device re-smoke where applicable. Builtin WebSearch is now enabled on mobile behind the existing DashScope/settings gates, with focused provider/ChatService tests, answer-stream runtime platform-policy tests, full serialized Jest, typecheck, lint, build, and whitespace checks passing. The later structured vault tool argument extraction gate above is fixed and smoke-clean for snippets, metadata, outline, canvas, path-specific note inspection, and current-note warning re-check.
  - Release scope: desktop mobile-emulation smoke is claimed; real iPhone core/current-note smoke is claimed for the covered paths; positive mobile WebSearch `requestUrl` auth evidence and cancel/recovery evidence are claimed after the API-key entitlement fix. `requestUrl` hard timeout/deadline behavior remains covered by adapter automated tests rather than a separate real-device timeout smoke. The telemetry baseline gate is closed as instrumentation/runbook readiness only; real post-ship aggregate collection remains future work because v1 has local/default-off events and no upload pipeline.
  - Source docs: `docs/pa-agent-design-completion-audit.md`; `docs/pa-agent-architecture-plan.md`; `docs/pa-agent-product-safety-review.md`; `docs/pa-agent-runtime-lifecycle-plan.md`; `docs/pa-agent-telemetry-baseline.md`.
  - Exit criteria: PA Agent development tracker SPEC-03/05/07/08 are completed or explicitly re-scoped, risk register has no open v1 blocker, verification log contains final evidence, and release readiness is not inferred from desktop-only smoke.

## Future Milestones

- [ ] Review and scope write action / command execution product and security design.
  - Context: the archived vault-native refactor track closed through Phase 6 with Chat still read-only. The active Ralpha plan also keeps write actions and Obsidian command execution out of scope. Future write actions must not be implemented by weakening the current read-only tool boundary.
  - Source docs: `docs/operations-agent-plan.md`; `docs/write-action-design-handoff.md`; archived historical docs under `docs/archive/`.
  - Entry criteria: define the first action family, allowed targets, preview / confirm UX, cancellation behavior, local-only redacted audit policy, permission settings, and rollback / failure handling.
  - Exit criteria: product/security review explicitly approves an implementation plan, creates a separate development tracker, and keeps direct note writes, arbitrary filesystem edits, shell/bash, and automatic Obsidian command execution out of scope unless separately approved.

- [ ] Collect post-ship PA Agent v1 telemetry baseline before using usage data for Operations Agent prioritization.
  - Context: PA Agent v1 telemetry is local/default-off and content-free; the current release gate only proves instrumentation and the collection runbook.
  - Source docs: `docs/pa-agent-telemetry-baseline.md`; `docs/pa-agent-design-completion-audit.md`.
  - Entry criteria: release candidate or released build with opt-in testers and at least seven days of aggregate capability usage events.
  - Exit criteria: aggregate counts, status distribution, and p50/p95 duration summaries are recorded without raw prompts, note text, observations, source snippets, URLs, vault paths, or file paths.

- [x] Complete real iPhone mobile WebSearch cancellation/recovery validation after enabling mobile export.
  - Context: PA Agent v1 desktop smoke and desktop mobile-emulation smoke passed. 2026-05-24 real iPhone smoke recorded a cold-start sample and validated PA Chat load, direct answer, current-note answer after retry, current-note-only full-context exact token lookup, historical mobile WebSearch-unavailable behavior, mobile WebSearch success after API-key entitlement fix, no-memory warning suppression, ordinary recovery after WebSearch, WebSearch cancel/recovery, and general cancel/recovery. The false WebSearch-required warning, non-current-note tool drift, exact-token lookup failure caused by bounded nearby current-note context, duplicate current-note tool-call empty-answer, mobile WebSearch 403 diagnostic, and no-memory false-warning issues were fixed with regression coverage.
  - Source docs: `docs/pa-agent-design-completion-audit.md`; `docs/pa-agent-architecture-plan.md`.
  - Entry criteria: mobile device or mobile runtime emulator with the Obsidian test vault and the deployed plugin assets.
  - Exit criteria: platform-unsupported capabilities remain unavailable, mobile WebSearch returns real web sources on iPhone when auth succeeds, no-memory prompts do not raise Memory warnings, and cancel recovery remains recoverable without provider-search fallback. Hard timeout/deadline handling stays covered by adapter automated tests unless a separate manual timeout fixture is introduced.

## Completed Priority Items

- [x] Complete RAG Phase 3: Query Rewrite + LLM Reranker.
  - Context: Phase 2 (FTS5 Hybrid Retrieval + RRF) was complete; Phase 3 adds LLM-based query rewriting for better FTS keywords and LLM reranking for improved relevance ordering.
  - Result: `query-rewriter.ts` extracts 2-6 keywords from user query via `policyModelName` LLM; `pa-agent-runtime.ts` integrates serial rewrite→searchHybrid→rerank pipeline with graceful degradation (short query skip, timeout fallback, candidates ≤1 skip).
  - Evidence: `__tests__/query-rewriter.test.ts` (136 lines); `__tests__/pa-agent-runtime-memory.test.ts` (150 lines); `npm test` passing.
  - Source docs: `docs/rag-hybrid-retrieval-plan.md`.

- [x] Implement generic PA Agent answer-completion controller.
  - Context: mobile and desktop smoke exposed repeated `Answer incomplete` paths caused by the same runtime gap: tool execution outcomes, required-capability policy, duplicate/no-op results, and empty assistant turns did not share one answer-readiness contract.
  - Result: `pa-agent-answer-completion-policy.ts` now derives turn facts, tracks a run evidence ledger, and returns generic finalization decisions. Required-capability HostPolicy uses that controller for failed required tools, duplicate/no-op tool results, and empty assistant turns after observations. `PaAgentLoop` carries `toolMode: final_answer_only`, and PA answer-stream finalization turns export no tool schemas while keeping existing observations available to the model.
  - Evidence: focused answer-completion/runtime tests passed 4 suites / 106 tests, including schema-invalid and missing-required-tool-input finalization coverage; `npx tsc -noEmit -skipLibCheck`; `npm run lint`; `npm run build`; `git diff --check`; `make deploy` passed 44 suites / 721 tests plus lint/build and copied assets into the local `test/` vault.
  - In-app validation: user-provided real iPhone smoke covers direct answer, current-note-only full-context exact token lookup, WebSearch success/unavailable handling, no-memory warning suppression, ordinary WebSearch recovery, WebSearch cancel/recovery, and general cancel/recovery. Desktop Obsidian policy re-smoke was rerun with Computer Use in the local `test` vault after `make deploy`: direct answer, current-note-only, and WebSearch success paths completed without visible `Answer incomplete`.

- [x] Close PA Agent v1 runtime lifecycle external verification gates.
  - Context: PA Agent v1 runtime lifecycle closeout required stricter evidence than older desktop smoke and could not infer live gates from app-log scans or automated tests alone.
  - Result: 2026-05-24 lifecycle tracker SPEC-01 through SPEC-08 are complete. The canonical audit/query identity contract is documented around mandatory `runId + turnId` on every event and exact `runId + turnId + seq` record lookup. Obsidian test-vault smoke evidence is recorded for direct answer, current-note tool, Memory, builtin WebSearch, unsupported warning UI, all 7 bundled-skill prompts, cancel/recovery, and direct DevTools console no-error inspection.
  - Evidence: `docs/pa-agent-runtime-lifecycle-plan.md`; `docs/pa-agent-design-completion-audit.md`; final closeout checks `npm test -- --runInBand`, `npm run lint`, `npm run build`, and `git diff --check`.

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
