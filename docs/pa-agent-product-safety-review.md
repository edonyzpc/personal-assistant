# PA Agent Product/Safety Review

Date: 2026-05-24

Scope: PA Agent v1 answer-stream runtime, capability policy, built-in Bailian WebSearch MCP adapter, bundled skill guides, source metadata, settings copy, and Operations Agent boundary.

## Result

Pass with explicit release re-scope; mobile WebSearch validation is complete for the covered v1 paths.

This review did not find a new product or safety blocker in the implemented PA Agent v1 surface. After the 2026-05-24 runtime lifecycle closeout, desktop live smoke covers direct answer, current-note tool, Memory, builtin WebSearch, unsupported warning UI, bundled skill guides, cancel/recovery, and DevTools console no-error inspection. Desktop Obsidian mobile-emulation smoke covers PA Chat load, direct answer, and the historical mobile WebSearch-unavailable warning path. Real iPhone smoke adds cold-start sample evidence and validates core chat/direct answer, current-note answer after retry, current-note-only full-context exact token lookup, historical mobile WebSearch-unavailable behavior, mobile WebSearch success after API-key entitlement fix, no-memory warning suppression, ordinary WebSearch recovery, WebSearch cancel/recovery, and general cancel/recovery. The iPhone-found current-note-only false WebSearch warning, tool drift, insufficient nearby context, duplicate-tool empty-answer, mobile WebSearch 403 diagnostic, and no-memory false-warning defects have code-level regression coverage and passed real-device re-smoke where applicable. The structured vault tool argument defect from later desktop smoke is mitigated by schema-aware `query`/`path` repair, regression tests, and targeted Obsidian smoke. The telemetry baseline gate is closed as instrumentation/runbook readiness only; real post-ship aggregate collection remains future work.

## Evidence Reviewed

- `CapabilityRegistry` / `PolicyEngine` policy path blocks action capabilities, write/local-script/shell/stdio permissions, confirmation-required capabilities, non-recoverable capabilities, and platform-unsupported capabilities before export and execution.
- `BuiltinWebSearchProvider` is a desktop/mobile `network-read` capability with an HTTPS allowlist, DashScope API-key auth, per-turn call cap, timeout, response-size budget, redaction, source URL sanitation, and untrusted web result wrapping.
- `ChatService.streamLLM(...)` defaults to the PA answer-stream path only for supported providers: OpenAI-compatible and DashScope-compatible Qwen. Declined providers such as Ollama remain on the legacy path.
- `SourceStore` separates Memory references, Context Used, web sources, and skill guides.
- Skill guides are context-only: they export no tool schema, have no execute path, and their bundled bodies are covered by read-only wording tests.
- Settings copy for web search and skill guides describes provider/API cost, read-only behavior, and non-modification of notes/Memory.
- `docs/operations-agent-plan.md` keeps write, command, script, and local MCP work out of PA Agent v1.

## Findings

No P0/P1 product-safety findings remain from the local review. The P2 current-note-only mobile follow-up from real iPhone smoke is closed by code-level classifier-veto, current-note-only tool-scope, exact-token full-context, and duplicate-tool follow-up fixes plus passing iPhone re-smoke. Mobile WebSearch readiness is closed for the covered v1 paths: authenticated iPhone success, recoverable unavailable/error handling, ordinary recovery, and cancel/recovery. Hard `requestUrl` timeout/deadline behavior remains adapter automated-test coverage unless a separate manual timeout fixture is introduced.

Accepted residual risks:

- Live desktop model behavior is verified for the PA Agent v1 closeout matrix. Automated prompt, source, and policy tests cover the intended behavior, and desktop Obsidian smoke has passed direct answer, current-note tool context, Memory, builtin WebSearch, unsupported warning UI, cancellation recovery, and 7/7 bundled skill prompts.
- Mobile WebSearch is enabled on mobile behind the existing DashScope/settings gates and has positive iPhone evidence for authenticated success with web sources, recoverable unavailable/error state, ordinary recovery, and cancellation recovery without provider-search fallback. Hard deadline behavior remains covered by adapter tests rather than a separate manual fixture.
- Telemetry baseline real aggregate data is not collected yet. The v1 events are local/default-off and content-free; `docs/pa-agent-telemetry-baseline.md` defines the post-ship collection boundary before Operations Agent planning uses usage data.

## Safety Decision

PA Agent v1 remains within the approved read/network-read boundary. No write/action capability, arbitrary MCP endpoint, shell/script execution, vault-local skill loading, or automatic note mutation path is approved by this implementation review.
