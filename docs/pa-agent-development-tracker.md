# PA Agent Development Tracker

## Status

| Field | Value |
| --- | --- |
| Track | PA Agent architecture upgrade |
| Current status | Planning contract created; implementation not started |
| Plan source of truth | [PA Agent Architecture Plan](./pa-agent-architecture-plan.md) |
| Comparison diagrams | [PA Agent Architecture Comparison](./pa-agent-architecture-comparison.md) |
| Current runtime baseline | `ChatService.streamLLM(...)`, `ChatAgentRuntime`, `ToolRegistry`, and Ralpha native planning loop |

This tracker records execution status only. Product, architecture, and boundary decisions live in the plan. If this tracker drifts from the plan, update both before implementation continues.

## Confirmed Decisions

- [x] PA Agent targets answer-stream tool loop design, not a new planning-loop intermediate.
- [x] Existing tools migrate unchanged first through CoreToolProvider.
- [x] `AgentCapability` is a ToolRegistry contract superset.
- [x] v1 permissions are `read-only` and `network-read`; `write` and script execution are future action-mode work.
- [x] Skill v1 is Context Capability, not a tool by default.
- [x] Source model separates Memory references, Context Used, Web sources, and Provider web status.
- [x] MCP WebSearch and Qwen provider built-in search are mutually exclusive per turn.
- [x] MCP v1 supports builtin remote MCP only, first Bailian WebSearch.
- [x] PA core, existing tools, and skill context target desktop and mobile.
- [x] WebSearch MCP targets desktop and mobile with mobile fallback.
- [x] Local stdio MCP, CLI, shell, and script execution are future desktop-only and not v1.
- [x] Providers load independently; CoreToolProvider is required, MCP and Skill providers are optional/recoverable.
- [x] PA Agent v1 does not keep old Memory presearch; Memory is called through `search_memory`.
- [x] MCP WebSearch is model-called in the answer-stream loop, not keyword-triggered.
- [x] Skill v1 supports automatic and user-explicit selection.

## MVP Shape

Core MVP:

- [ ] Answer-stream tool loop.
- [ ] Existing Memory, current-note, and vault read tools migrated through CoreToolProvider.
- [ ] Source and Context Used UX for Memory, current note, vault structure, snippets, and provider web status.
- [ ] Cancellation, fallback, and no-replay behavior preserved.

Required v1 capabilities:

- [ ] Builtin Bailian WebSearch MCP.
- [ ] SkillContextProvider v1.

PA Agent v1 is not complete until WebSearch MCP and SkillContextProvider v1 are delivered or explicitly re-scoped by a later product decision. They remain separately gated so their platform, safety, and source-boundary checks can fail independently without weakening the core runtime.

## Phase Plan

### SPEC-00: Architecture Contract

| Field | Value |
| --- | --- |
| Status | [x] Done |
| Goal | Capture confirmed PA Agent product, runtime, capability, source, MCP, skill, and platform decisions. |
| Owner docs | `docs/pa-agent-architecture-plan.md`, `docs/pa-agent-development-tracker.md`, `docs/pa-agent-architecture-comparison.md` |
| Out of scope | Runtime code changes. |
| Exit gate | Plan and tracker exist; comparison doc points to plan as source of truth; whitespace check passes. |

Verification:

- [x] `git diff --check`
- [x] `rg -n "[[:blank:]]+$" docs/pa-agent-architecture-plan.md docs/pa-agent-development-tracker.md docs/pa-agent-architecture-comparison.md`

### SPEC-01: CapabilityRegistry And CoreToolProvider

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Introduce the minimum `CapabilityRegistry`, `PolicyEngine`, and `CoreToolProvider` boundary before answer-stream tool calls are implemented. |
| Owner files | `src/ai-services/*capability*`, `src/ai-services/chat-tools.ts`, `src/ai-services/chat-agent.ts`, related tests |
| Out of scope | Answer-stream runtime replacement, MCP provider, skill provider, write/actions. |
| Exit gate | Existing tools can be listed/exported/executed through the registry adapter; policy filters before schema export and execution; duplicate names are rejected; stable ordering and budgets are preserved. |

Required checks:

- Existing tool tests remain green.
- New tests for provider load, duplicate names, stable ordering, policy rejection, output budget, `current-note` source boundary mapping, and recoverable failures.
- Typecheck for the new capability/provider/result/source interfaces.

### SPEC-02: Tool-Calling Stream Protocol

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Define and test the provider adapter protocol for streamed tool calls before replacing the runtime loop. |
| Owner files | `src/ai-services/*tool-calling*`, `src/ai-services/ai-utils.ts`, provider fixtures/tests |
| Out of scope | Runtime replacement, MCP, skill loading, write/actions. |
| Exit gate | OpenAI-compatible/Qwen/Ollama support is explicitly supported, gated, or declined; streamed tool chunks, tool call ids, tool result messages, abort, and final snapshot semantics are covered by fixtures. |

Required checks:

- Fixture tests for direct answer, tool-call chunk aggregation, multiple tool calls, partial JSON arguments, `tool_call_id` preservation, tool result re-injection, abort during stream, and provider unsupported fallback.
- Tests that current final-stream late-tool-call protocol errors are intentionally replaced only on the PA Agent path.

### SPEC-03: Answer-Stream Tool Loop Runtime

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Replace PA target runtime path with model streaming that can emit answer deltas and tool calls in the same loop. |
| Owner files | `src/ai-services/chat-agent.ts`, `src/ai-services/chat-service.ts`, capability registry modules, related chat runtime tests |
| Out of scope | MCP provider, skill loading, write/actions, user-configured providers. |
| Exit gate | Existing chat entrypoint and cumulative snapshot semantics remain compatible; all tool calls execute through `CapabilityRegistry`; abort and no-replay fallback remain correct. |

Required checks:

- Focused runtime tests for direct answer, tool call then answer, multiple tool calls, abort during stream, abort during tool, failure before visible output, failure after visible output.
- Tests that old automatic Memory presearch is not used on the PA Agent path and `search_memory` is model-callable.
- Typecheck.
- Obsidian smoke for direct answer, Memory/tool answer, cancel, and fallback.

### SPEC-04: Source Model And UI Metadata

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Implement `SourceRecord`/`SourceStore` and separate source buckets for Memory references, Context Used, Web sources, Provider web status, and skill guide context. |
| Owner files | `src/ai-services/chat-types.ts`, `src/ai-services/chat-agent.ts`, `src/chat-view.ts`, source metadata tests |
| Out of scope | Actual MCP WebSearch implementation. |
| Exit gate | Web sources can be represented without becoming Memory references; provider web status cannot pretend to be a citation. |

Required checks:

- Tests for source bucket separation, redaction, truncation, duplicate handling, URL sanitization, UI labels, and Memory-only references.
- Obsidian smoke for Memory references plus Context Used.

### SPEC-05: Builtin WebSearch MCP

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Add builtin remote Bailian WebSearch MCP as a gated `network-read` tool capability. |
| Owner files | MCP provider/adapter modules, settings integration if needed, AI service transport helpers, runtime tests |
| Out of scope | User-configured MCP, local stdio MCP, arbitrary endpoints, local MCP servers. |
| Exit gate | WebSearch MCP is model-callable, endpoint allowlisted, key-redacted, timeout/budget/call-limited, recoverable on failure, and source-producing. |

Required checks:

- Adapter spike/ADR or fixture package deciding official SDK, narrow HTTP adapter, or hybrid before implementation.
- Unit tests for allowlist, missing key, timeout, response truncation, oversized response, call cap, key redaction across query/body/header/error/source, URL sanitization, prompt-injection wrapping, and recoverable unavailable state.
- Test that MCP WebSearch disables provider built-in web search for the same turn.
- Test provider search fallback/status when MCP is unavailable and settings allow it.
- Test explicit-search provider fallback/status when MCP is unavailable, exported but not called, or called and recoverably fails.
- Desktop smoke with a search prompt.
- Mobile smoke with `requestUrl`/auth/deadline evidence before mobile export; otherwise MCP stays unavailable on mobile and provider-status fallback may be used.
- Bundle/metafile audit.

### SPEC-06: SkillContextProvider V1

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Add skill discovery, selection, bounded context loading, and Context Used records. |
| Owner files | skill provider/router modules, settings/UI if needed, context builder, runtime tests |
| Out of scope | Skill scripts, custom skill tools, write/actions, shell/CLI, marketplace. |
| Exit gate | Skills can guide answers without exporting tool schemas, granting permissions, executing scripts, or bypassing CapabilityRegistry. |

Required checks:

- Start with plugin-bundled skill metadata and Markdown resources unless a later decision approves vault-local skill folders.
- Tests for metadata-only discovery, explicit selection priority, deterministic automatic selection, skill count cap, context budget, untrusted context wrapping, no permission grant, no tool-schema export, no `execute()`, and no script execution.
- Tests that skill context appears in Context Used and not Memory references.
- Obsidian smoke for a writing/organization skill scenario.

### SPEC-07: Platform And Packaging Gates

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Prove desktop/mobile compatibility and prevent Node-only or heavy SDK paths from breaking mobile. |
| Owner files | build config, provider modules, platform gates, tests |
| Out of scope | New product features. |
| Exit gate | Unsupported capabilities do not register/export on mobile; bundle impact is measured; mobile fallback is verified or explicitly deferred. |

Required checks:

- Tests for platform gating.
- Build.
- Lint.
- Reproducible bundle/metafile review command or script, size budget, and Node builtin/polyfill audit before MCP/skill dependencies are default-enabled.
- Desktop Obsidian smoke.
- Mobile smoke when MCP or skill paths are enabled for mobile.

### SPEC-08: Closeout Review

| Field | Value |
| --- | --- |
| Status | [ ] Todo |
| Goal | Close PA Agent v1 with review, verification, docs, and future-action boundaries aligned. |
| Owner files | Plan, tracker, todo, runtime/UI/tests touched by implementation |
| Out of scope | Starting write/script/local MCP implementation. |
| Exit gate | No unresolved P2/P1/P0 findings remain unless explicitly deferred; smoke and verification logs are complete. |

Required checks:

- Subagent architecture review.
- Product/safety review.
- Focused tests.
- `npm test -- --runInBand` when broad runtime changes land.
- `npm run lint`.
- `npm run build`.
- `git diff --check`.
- Obsidian smoke matrix.

## Risk Register

| Risk | Severity | Mitigation | Status |
| --- | --- | --- | --- |
| Current implementation baseline confused with target answer-stream loop | P1 | Plan states current planning loop and PA target loop separately. | Open until SPEC-01 lands |
| Capability policy too weak for MCP/network/skill | P1 | Make `AgentCapability` a policy contract superset before MCP. | Open |
| Provider load failure breaks chat | P1 | Optional providers are recoverable; only available policy-allowed capabilities export. | Open |
| Web sources mixed into Memory references | P1 | Four source buckets and UI tests. | Open |
| Provider built-in search hides untracked network use | P1 | MCP/provider search mutually exclusive per turn. | Open |
| Skill context grants implicit permission | P1 | Skill v1 is context-only and untrusted. | Open |
| MCP SDK introduces Node/streaming-only mobile breakage | P2 | Prefer narrow WebSearch adapter; bundle/mobile gates. | Open |
| Security policy harms usability | P2 | Builtin defaults, recoverable failure, no per-search confirmation for v1 web search. | Open |
| Future write/script pressure weakens v1 boundary | P1 | Future action mode requires separate design and tracker. | Open |
| Prompt injection through web, skill, or vault context | P1 | All observations are untrusted data; add injection tests before MCP/skill enablement. | Open |
| Web source URL creates unsafe UI links | P1 | Add URL sanitizer and source snapshot tests before Web sources ship. | Open |

## Verification Log

| Date | Scope | Command or smoke | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-22 | SPEC-00 | `git diff --check` | Passed | Docs-only setup. |
| 2026-05-22 | SPEC-00 | `rg -n "[[:blank:]]+$" docs/pa-agent-architecture-plan.md docs/pa-agent-development-tracker.md docs/pa-agent-architecture-comparison.md` | Passed | Covered new untracked docs before staging. |

## Open Decisions

- [ ] Exact answer-stream tool-call protocol shape for each supported model/provider.
- [ ] Whether PA Agent answer-stream loop should be implemented inside `ChatAgentRuntime` first or extracted to a new `PaAgentRuntime` class immediately.
- [ ] Exact Bailian WebSearch MCP adapter strategy: official SDK path, narrow HTTP adapter, or hybrid.
- [x] WebSearch MCP and SkillContextProvider are required PA Agent v1 capabilities, with independent platform/safety gates.
- [x] Explicit-search requests may use provider search fallback/status when MCP WebSearch is unavailable, not called, or recoverably fails; fallback provider search does not create Web sources.
- [x] SkillContextProvider v1 uses plugin-bundled skill metadata and Markdown resources; vault-local skill folders are future work.
- [ ] Context Used UI grouping for simultaneous Memory, vault tools, web sources, and skill guides.
