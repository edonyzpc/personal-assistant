# Vault-native Assistant Development Tracker

## Purpose

本文档用于跟踪 `docs/PLAN.md` 中 Vault-native Obsidian Assistant 重构方案的开发任务、验证证据、review 结论、修复记录和 Obsidian smoke 结果。

设计依据：

- [Vault-native Obsidian Assistant Refactor Plan](./PLAN.md)

本文档不是架构设计的替代品。涉及产品定位、架构边界、Memory workflow、ToolRegistry policy、native rollout、隐私和写入边界时，以 `docs/PLAN.md` 为准；本文档只记录执行计划和进度。

## Status Legend

| 标记 | 含义 |
| --- | --- |
| `[ ]` | Todo，尚未开始 |
| `[~]` | In progress，正在开发、验证或修复 |
| `[x]` | Done，已完成并有验证证据 |
| `[!]` | Blocked，需要决策、外部条件或失败修复 |

## Required Delivery Loop

每个可交付任务都必须按以下顺序推进，不能跳过 review 或 smoke：

```mermaid
flowchart LR
  Dev["dev\n实现或文档迁移"]
  Test["test\n自动化/静态检查"]
  Review["review\nCodex subagents"]
  Fix1["fix\n处理 review findings"]
  Smoke["Obsidian smoke test\n真实 test vault"]
  Fix2["fix\n处理 smoke findings"]
  Done["done\n记录证据"]

  Dev --> Test --> Review --> Fix1 --> Smoke --> Fix2 --> Done
```

Review gate 固定要求：

- Codex 必须使用 subagents 的方式进行 review。
- 至少覆盖这些视角：product、architecture、safety/trust、implementation/QA。
- Review 只接受当前 live diff，不复述旧结论。
- Review 输出必须区分 must-fix、optional polish 和 no-action findings。
- 所有 P1/P2 findings 必须进入本 tracker 的 Fix 记录或 Risk 表。

Smoke gate 固定要求：

- 涉及 Chat UI、runtime、Memory routing、turn lifecycle、ToolRegistry/native path 的任务，必须执行 `make deploy` 后在 `test/` vault 做 Obsidian smoke。
- 不得声称已完成 Obsidian 行为验证，除非已经真实部署并在 Obsidian 中测试。
- 如果某个 phase 不需要 Obsidian smoke，必须在该 phase 的 smoke 记录中说明原因和残余风险。

## Current Status

| 项目 | 状态 |
| --- | --- |
| 创建日期 | 2026-05-10 |
| Source of truth | `docs/PLAN.md` |
| 当前阶段 | Phase 5 follow-up: Qwen Native Default Rollout |
| 当前状态 | [x] qwen/qwen-plus/DashScope is the default native context/tool planning path; Chat remains read-only and future writes require separate product/security review |
| 当前分支 | `codex/chat-agent-next-refactor-plan` |
| Review policy | 每个阶段 review 必须使用 Codex subagents |
| Smoke policy | UI/runtime 行为变更必须 deploy 到 `test/` vault 后验证 |

## Phase Overview

| Phase | Goal | Status | Primary Owners | Exit Gate |
| --- | --- | --- | --- | --- |
| Phase 0A | Docs Migration Gate | [x] Done | `docs/PLAN.md`, `docs/archive/*`, this tracker | 旧 docs 归档，source-of-truth 冲突消除 |
| Phase 0B | Baseline Behavior Inventory | [x] Done | `docs/PLAN.md`, `src/ai-services/*`, `__tests__/chat-service.test.ts` | 当前行为、保持项、待重构项记录清楚 |
| Phase 1 | Intent-aware Memory Workflow | [x] Done | `chat-agent.ts`, `memory-manager.ts`, `chat-service.test.ts` | 内容型输入默认 Memory search；agent-control 跳过 |
| Phase 2 | Core Extraction + Turn Lifecycle | [x] Done | `chat-agent.ts`, `chat-service.ts`, `chat-view.ts`, `chat-types.ts` | `AgentTurnPlan` 与 `sessionId/turnId` lifecycle 落地 |
| Phase 3 | Policy / ToolRegistry / Vault Advice Hardening | [x] Done | `chat-tools.ts`, `chat-agent.ts`, `chat-types.ts` | Registry 成为唯一 source of truth；vault advice evidence gate 落地 |
| Phase 4 | Native Feasibility Behind Internal Gate | [x] Done | `ai-utils.ts`, `chat-agent.ts`, `chat-tools.ts`, `chat-service.ts` | Native planning loop landed behind capability gate; JSON fallback and disabled-gate smoke passed |
| Phase 5 | Native Rollout Decision | [x] Done | `ai-utils.ts`, `chat-agent.ts`, `chat-tools.ts`, `chat-service.ts` | qwen/qwen-plus/DashScope promoted to default native context/tool planning; openai/ollama remain unverified and use JSON fallback |
| Phase 6 | Write Action Design Handoff | [x] Done | docs only | 写入和 command execution 另开 product/security review |

## Archived Evidence Summary

以下内容从 `docs/archive/*` 迁移为 compact index，只作为历史验证索引和 Phase 0B baseline 输入，不替代当前代码检查。

| Evidence Area | Archived Evidence | Current Use |
| --- | --- | --- |
| Phase 1 Memory retrieval baseline | `chat-agent-development-tracker.md` 记录 focused/full Jest、type check、lint、`make deploy`、普通问题、笔记检索、取消路径和 Memory 未准备 / `Answer now` smoke 曾通过 | Phase 0B 需要重新用当前代码确认哪些行为保留、哪些会被 Phase 1 intent-aware routing 有意改变 |
| Phase 2 read-only tools baseline | Archived tracker 记录 current note、metadata search、recent notes、outline tools 的 focused/full Jest、type check、lint、build、deploy 和 Obsidian smoke 曾通过 | Phase 0B baseline 应保留 tool loop、context boundary、tool-note prompt 和 Memory references 隔离作为当前锚点 |
| Historical risk closures | Planner JSON instability、nested JSON template escaping、Memory approval timing、reference hallucination、abort propagation、Thinking scroll 已有历史修复或验证记录 | 新风险表只保留仍影响后续重构的风险；已关闭项在 Phase 0B 作为 regression checklist |
| Known residual follow-ups | Latency 需真实使用中观察；最终 assistant message 原地更新/flicker 是低风险 follow-up；无 active Markdown file smoke 曾作为补充项 | 不作为 Phase 0A blocker；如 Phase 2 lifecycle/UI 触及相关代码，再纳入 test/smoke |
| Recent decisions | action-only JSON、只读工具先行、显式 `tool` action、当前笔记内容作为 `untrusted_content`、`Answer now` 本轮生效、非 Memory 工具结果走 `<tool_context>` | 当前 PLAN 已重新定义 source of truth；这些决策作为历史背景，后续若冲突以 PLAN 为准 |
| Superseded write-action guidance | Archived docs 早期提到记录 `input` / `target` / `result` 等 audit 字段 | 已被 PLAN 的 redacted diagnostics / future write audit contract 替代；不得按 archive 原文实现完整正文/path 持久化 |

## Phase Task Plan

### Phase 0A: Docs Migration Gate

Goal: 保留历史验证证据，并让 `docs/PLAN.md` 成为新的设计 source of truth。

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Archive superseded Chat Agent docs and link them from PLAN | `docs/archive/*`, `docs/PLAN.md` | [x] Done | 旧 docs 仅作为历史记录保留，不再作为执行依据 |
| dev | Add archive banners and migrate compact historical evidence index | `docs/archive/*`, this tracker | [x] Done | Archived docs self-identify as historical; key validation/risk/decision evidence is indexed here |
| test | Run doc/static checks | docs | [x] Done | `git diff --check` plus explicit trailing-whitespace scan covers tracked and untracked Phase 0A docs |
| review | Codex subagents review docs migration | docs | [x] Done | product/architecture/safety/QA review found P1/P2 issues; all addressed below |
| fix | Address review findings | docs | [x] Done | Archive banners, evidence index, and verification wording fixed |
| Obsidian smoke test | Decide whether smoke is needed | docs | [x] Skipped | Docs-only change; no UI/runtime behavior changed; residual risk is doc navigation only |
| fix | Address smoke/doc final findings | docs | [x] Done | No smoke blockers; final docs checks recorded |

Expected commands:

- `git diff --check`

Review reminder:

- Ask Codex to use subagents to review `docs/PLAN.md`, archived docs, and this tracker against the current repo state.

### Phase 0B: Baseline Behavior Inventory

Goal: 在改代码前记录当前 runtime 行为，避免误把历史 `presearch-first` 当最终目标。

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Document current behavior anchors and known intentional changes | `docs/PLAN.md`, this tracker | [x] Done | Baseline includes presearch, planner, tool loop, prompt plan, final streaming owner |
| test | Run current focused chat tests | `__tests__/chat-service.test.ts` | [x] Done | Current baseline tests pass before refactor |
| review | Codex subagents review baseline inventory | docs + current code | [x] Done | Review confirmed baseline matches live code; one PLAN phase-label drift fixed |
| fix | Correct any baseline drift | docs | [x] Done | `AgentEvent` / turn lifecycle wording moved from Phase 1 to Phase 2 |
| Obsidian smoke test | Optional baseline smoke | `test/` vault | [x] Skipped | Docs-only baseline inventory; automated tests passed; residual risk is Obsidian-only environment drift |
| fix | Record smoke follow-ups | docs | [x] Done | Runtime smoke deferred to Phase 1 after code changes |

Phase 0B live-code baseline:

| Area | Current Anchor | Keep / Change Boundary |
| --- | --- | --- |
| Stable external entry | `src/ai-services/chat-service.ts` creates `ChatAgentRuntime`, waits for an `AgentPromptPlan`, then owns final model streaming and non-streaming fallback | Keep `ChatService.streamLLM(...)` as the user-visible final answer streaming owner through Phase 2/4 |
| Current default Memory flow | `ChatAgentRuntime.run(...)` calls `presearchMemory(...)` before planner unless `memoryMode === "skip-memory"` | Phase 1 intentionally changes this to intent-aware routing: content-seeking keeps Memory search; agent-control skips readiness/search |
| Memory readiness/search | `MemorySearchTool.search(...)` calls `MemoryManager.ensureReadyForChat(query)` and then `plugin.vss.searchSimilarity(query)` unless user cancels or chooses `Answer now` | Keep approval semantics and `Answer now` one-turn skip; add agent-control bypass before this path |
| Planner/tool loop | `ChatPlanner` emits action-only JSON; runtime supports `answer`, legacy `retrieve`, and registered `tool` actions | Keep JSON planner as reliable fallback; native path stays future gated work |
| Registered read-only tools | `ToolRegistry` executes `search_memory`, `get_current_note_context`, `search_vault_metadata`, `list_recent_notes`, and `read_note_outline` with validation, abort checks, and bounded failures | Keep source-boundary behavior; Phase 3 hardens metadata/schema/policy into registry as single source of truth |
| Context and references | `PromptBuilder` separates `memory`, `current-note`, and `tool-note`; only selected Memory sources enter `allowed_sources` / Memory references | Keep this boundary across all future phases |
| UI status and cancellation | `src/chat-view.ts` renders a single Thinking timeline from `ChatAgentStatus`; cancel aborts current controller; clear chat currently clears UI/history without turn-id stale callback protection | Phase 2 adds `sessionId/turnId` guards for stale status/chunk/final render |
| Existing coverage | `__tests__/chat-service.test.ts` covers fallback-after-visible-chunk policy, presearch, planner parsing, `use_memory`, `Answer now`, skip-memory, abort, current note, metadata/recent/outline tools, context budgets, and source-boundary cases | Phase 0B tests verify this baseline before runtime refactor begins |

Known intentional changes after Phase 0B:

- Phase 1 will not preserve unconditional presearch-first for agent-control / workflow-continuation inputs.
- Phase 2 will not move final answer streaming out of `ChatService`; it only adds core/turn lifecycle boundaries.
- Phase 3 will not add write actions; it hardens read-only tool metadata, policy, and vault advice evidence classification.
- Phase 4/5 native work must stay behind capability gates and fallback before any visible final answer chunk.

Expected commands:

- `npm test -- __tests__/chat-service.test.ts`
- `npx tsc -noEmit -skipLibCheck`
- `git diff --check`

### Phase 1: Intent-aware Memory Workflow

Goal: 内容型输入默认 Memory search；明显 agent-control / workflow-continuation 输入跳过 Memory readiness/search/embedding。

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add intent routing before Memory search | `src/ai-services/chat-agent.ts`, `src/ai-services/chat-types.ts` | [x] Done | `content-seeking` and `agent-control` are explicit runtime states |
| dev | Preserve content-seeking default Memory search | `src/ai-services/chat-agent.ts` | [x] Done | Ordinary content questions still call Memory search by default |
| dev | Skip Memory for agent-control inputs | `src/ai-services/chat-agent.ts` | [x] Done | “继续任务/下一步/按上面的方案修复/停止/重试” do not call `ensureReadyForChat` or VSS |
| dev | Update Memory cost/data copy if user-visible text changes | `src/memory-manager.ts`, relevant docs | [x] Done | Approval copy now separates prepare/update note text from per-turn Memory search query/provider scope |
| test | Add focused regression tests | `__tests__/chat-service.test.ts` | [x] Done | Tests cover content-seeking search, agent-control skip, Answer now, no references when no Memory selected |
| review | Codex subagents review Phase 1 diff | runtime + tests | [x] Done | Product/runtime/safety/QA findings triaged; P1/P2 fixes recorded below |
| fix | Address subagent findings | runtime + tests | [x] Done | Classifier guard/broadened phrases, primary `tool/search_memory` regression, and Memory search trust copy added |
| Obsidian smoke test | Deploy and validate intent-aware Memory workflow | `test/` vault | [x] Done | `make deploy` completed; all required smoke cases passed in Obsidian test vault |
| fix | Address smoke findings | runtime/UI/tests/docs | [x] Done | No P1/P2 smoke blockers found; tracker evidence recorded |

Required smoke cases:

- Content question: Memory search runs; answer only shows Memory references if real related sources are selected.
- Agent-control input: no Memory readiness/search.
- Memory not ready + content question: confirmation appears; Answer now continues without Memory.
- Memory not ready + agent-control input: no Memory confirmation.

Expected commands:

- `npm test -- __tests__/chat-service.test.ts`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `git diff --check`
- `make deploy` for smoke

### Phase 2: Core Extraction And Turn Lifecycle

Goal: Extract `ObsidianAgentCore`/`AgentTurnPlan` without moving final answer streaming out of `ChatService`, and add `sessionId/turnId` lifecycle.

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Introduce `AgentTurnPlan` | `src/ai-services/chat-types.ts`, `src/ai-services/chat-agent.ts` | [x] Done | Runtime now exposes `planTurn(...)` returning a prompt plan wrapper, not visible chunks |
| dev | Keep `ChatService` as final streaming owner | `src/ai-services/chat-service.ts` | [x] Done | Existing streaming and non-streaming fallback semantics preserved |
| dev | Add lightweight turn lifecycle | `src/chat-view.ts`, `src/ai-services/chat-service.ts` | [x] Done | `sessionId/turnId` active turn guards status/chunk/final render |
| dev | Invalidate active turn on cancel/clear/view close | `src/chat-view.ts` | [x] Done | Stale callbacks cannot write into cleared/cancelled view |
| test | Add stale callback and lifecycle tests | `__tests__/chat-view.test.ts` | [x] Done | clear, cancel, close, stale status/chunk, AbortError, button state, and pending rAF paths covered |
| review | Codex subagents review Phase 2 diff | runtime/UI/tests | [x] Done | Architecture/UI review found no P1/P2; testing review findings were fixed |
| fix | Address subagent findings | runtime/UI/tests | [x] Done | AbortError reject tests, hidden cancel assertions, and pending rAF cleanup coverage added |
| Obsidian smoke test | Deploy and validate lifecycle | `test/` vault | [x] Done | `make deploy` plus real Obsidian reload validated initial controls, clear active turn, cancel final answer, and rapid send after cancel |
| fix | Address smoke findings | runtime/UI/tests/docs | [x] Done | Smoke found visible initial cancel button; fixed with explicit hidden class and stronger scoped CSS selectors, then re-deployed and re-tested |

Required smoke cases:

- Cancel during Memory search/tool/final answer.
- Clear chat during active generation.
- Rapid send after previous cancel.
- Long streaming response with Thinking expanded and user scrolled away.

Expected commands:

- `npm test -- __tests__/chat-service.test.ts`
- `npm test -- --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `git diff --check`
- `make deploy`

### Phase 3: Policy / ToolRegistry / Vault Advice Hardening

Goal: Make ToolRegistry the single source of truth, and make `vault_advice_context` a required policy gate.

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Preserve complete tool metadata in registry | `src/ai-services/chat-tools.ts` | [x] Done | Registry retains schema/policy/budget/source-boundary metadata |
| dev | Add registry access/export APIs | `src/ai-services/chat-tools.ts` | [x] Done | `listDefinitions()`, `getDefinition()`, provider schema export hooks exist |
| dev | Route JSON planner and native path through same registry | `src/ai-services/chat-agent.ts`, `src/ai-services/chat-tools.ts` | [x] Done | JSON planner consumes registry definitions; future native schema export is registry-derived |
| dev | Implement vault advice evidence classification | `src/ai-services/chat-agent.ts`, `src/ai-services/chat-types.ts` | [x] Done | `explicit_rule`, `template_or_workflow`, `fact_context`, `insufficient_evidence` enforced |
| test | Add policy/source-boundary/prompt-injection tests | `__tests__/chat-service.test.ts` | [x] Done | Ordinary notes cannot become preferences; fake refs/commands/writes are rejected |
| review | Codex subagents review Phase 3 diff | tools/policy/tests | [x] Done | Safety/trust subagent explicitly reviewed prompt-injection and evidence fixtures |
| fix | Address subagent findings | tools/policy/tests | [x] Done | Must-fix findings closed and re-reviewed |
| Obsidian smoke test | Deploy and validate vault advice and references | `test/` vault | [x] Done | Mixed Memory/current/tool context boundaries verified |
| fix | Address smoke findings | tools/policy/tests/docs | [x] Done | No P1/P2 smoke blockers found; explicit/template fixtures covered by automated tests |

Expected commands:

- `npm test -- __tests__/chat-service.test.ts`
- `npm test -- --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 4: Native Feasibility Behind Internal Gate

Goal: Prove native tool calling feasibility without changing the default JSON planner path.

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add provider/model/baseURL capability helper | `src/ai-services/ai-utils.ts` | [x] Done | Unknown capability defaults to unsupported; validated tuple requires provider/model/baseURL |
| dev | Prototype provider-compatible schema export | `src/ai-services/chat-tools.ts` | [x] Done | Safe export result exists and export failure can fall back to JSON planner |
| dev | Add native path behind internal gate | `src/ai-services/chat-agent.ts` | [x] Done | Disabled by default; runtime option enables native read-only tool planning in tests; final answer streaming remains owned by `ChatService` |
| dev | Add fallback-before-visible-output guard | `src/ai-services/chat-service.ts`, `src/ai-services/chat-agent.ts` | [x] Done | Existing `canFallbackToNonStreaming` guard remains covered; no replay after visible final chunk |
| test | Add mock tool-call stream fixtures | tests | [x] Done | OpenAI-compatible response, LangChain chunk, schema bind, native registry execution, invalid args fallback, and incomplete native planning fallback covered |
| review | Codex subagents review Phase 4 diff | native/tool/provider/tests | [x] Done | First-slice provider P2 was fixed; native-loop architecture/provider/test reviews found no P0/P1/P2 |
| fix | Address subagent findings | native/tool/provider/tests | [x] Done | Must-fix baseURL wildcard finding closed; no second-slice P0/P1/P2 findings |
| Obsidian smoke test | Provider smoke where practical | `test/` vault | [x] Done | Unsupported/disabled native gate keeps JSON path stable |
| fix | Address smoke findings | native/tool/provider/tests/docs | [x] Done | No smoke blockers found |

Expected commands:

- `npm test -- __tests__/chat-service.test.ts`
- `npm test -- --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 5: Native Rollout Decision

Goal: Enable native context/tool loop only for validated provider/model/baseURL combinations.

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add validated provider rollout table/config | `src/ai-services/ai-utils.ts`, docs | [x] Done | Default rollout table promotes qwen/qwen-plus/DashScope; smoke/canary tuple list remains available for future validations |
| dev | Keep JSON planner long-term fallback | `src/ai-services/chat-agent.ts`, `src/ai-services/chat-service.ts` | [x] Done | Unvalidated provider/model/baseURL combinations stay on JSON planner fallback while validated qwen defaults to native planning |
| dev | Add redacted diagnostics | runtime/docs | [x] Done | Native diagnostics record gate/result/schema category only; tests assert no prompt body or note path in logs |
| dev | Add hidden provider smoke gate | `src/ai-services/chat-service.ts`, `src/settings.ts`, `src/plugin.ts` | [x] Done | Hidden flag now selects the smoke/canary validation list for future provider checks; validated qwen/qwen-plus/DashScope uses the default validation table |
| test | Add native-vs-JSON equivalence tests | tests | [x] Done | Same-scenario read-only context equivalence is covered; qwen default rollout adds focused default-gate coverage |
| review | Codex subagents review Phase 5 rollout | native/runtime/docs | [x] Done | Runtime review found no P0/P1/P2; docs review P2 status drift was fixed |
| fix | Address subagent findings | native/runtime/docs | [x] Done | Fixed docs/tracker drift around hidden smoke gate, default table status, and openai/ollama deferred state |
| Obsidian smoke test | Validate enabled provider path | `test/` vault | [x] Done | Hidden flag stayed false; default qwen/qwen-plus/DashScope native metadata path found `0.unsorted/Dog.md` without fallback |
| fix | Address smoke findings | native/runtime/docs | [x] Done | No P1/P2 smoke blockers found |
| go/no-go | Default rollout decision | docs/runtime | [x] Done | Go for qwen/qwen-plus/DashScope default native planning after validation; defer openai/ollama |

Expected commands:

- `npm test -- __tests__/chat-service.test.ts`
- `npm test -- --runInBand`
- `npx tsc -noEmit -skipLibCheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`

### Phase 6: Write Action Design Handoff

Goal: Keep write action and command execution out of this implementation track until separate product/security review.

| Step | Task | Owner Files | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Draft separate write action design if requested | `docs/write-action-design-handoff.md`, `docs/PLAN.md` | [x] Done | No runtime write action lands in this phase |
| test | Validate docs and scope only | docs | [x] Done | `git diff --check` passed for docs |
| review | Codex subagents review write action design | docs | [x] Done | Product/security review passed; architecture/QA P2 status findings fixed |
| fix | Address design findings | docs | [x] Done | Phase 5 test status and Phase 6 closeout status aligned |
| Obsidian smoke test | Not required unless prototype exists | docs/test vault | [x] Skipped | Docs-only handoff; no UI/runtime behavior changed and no write prototype exists |
| fix | Address smoke/design findings | docs | [x] Done | Tracker records final write-boundary decision |

## Review Log

| Date | Phase | Reviewer Mode | Result | Findings | Follow-up |
| --- | --- | --- | --- | --- | --- |
| 2026-05-10 | Initial tracker | Local doc creation | [x] Superseded by Phase 0A review | None at creation time | Phase 0A subagent review completed |
| 2026-05-10 | Phase 0A | Codex subagents: product, architecture, safety/trust, implementation/QA | [x] Must-fix addressed | P1/P2: archived docs lacked superseded banners; archive evidence was not indexed in new tracker; `git diff --check` wording overstated untracked-doc coverage | Added archive banners, migrated compact evidence summary, added explicit untracked-doc whitespace evidence, and recorded docs-only smoke skip |
| 2026-05-10 | Phase 0B | Codex subagents: product, architecture, safety/trust, implementation/QA | [x] Fixed | P2/P3: `PLAN.md` still assigned turn lifecycle / `AgentEvent` adapter wording to Phase 1; top tracker status lagged behind actual progress | Updated PLAN wording to Phase 2, closed baseline smoke as skipped for docs-only work, and moved tracker to Phase 1 |
| 2026-05-10 | Phase 1 | Codex subagents: product, architecture/runtime, safety/trust, QA | [x] Fixed | P1/P2: classifier was brittle in both directions; test covered legacy `retrieve` but not primary `tool/search_memory`; per-turn Memory search trust copy was not reflected in approval copy/tracker | Added source-signal guard, broader workflow-control phrases, primary tool-call regression, classifier positive/negative tests, and per-turn Memory search copy |
| 2026-05-10 | Phase 2 | Codex subagents: architecture/runtime, UI lifecycle, testing/QA | [x] Fixed | P1/P2: clear/onClose tests did not reject with real AbortError; cancel visibility assertions could click a hidden affordance; rAF cleanup was not exercised while pending | Added AbortError rejection paths, visible/hidden button assertions, controllable rAF tests, and stale-frame guard |
| 2026-05-10 | Phase 2 smoke | Live Obsidian test vault | [x] Fixed | P2: after real Obsidian reload the initial cancel button was visible because class application/CSS specificity did not match the deployed DOM | Added `cancel-button-hidden` via `classList.add`, strengthened `.llm-view .llm-buttons button.*` selectors, rebuilt, deployed, and re-tested |
| 2026-05-10 | Phase 3 | Codex subagents: architecture/runtime, safety/trust, testing/QA | [x] Fixed | P1/P2: planner prompt still duplicated hardcoded tool examples outside registry; broad terms like `must`, `frontmatter`, and `template` could upgrade factual notes into advice evidence; registry tests were too shallow and lacked `template_or_workflow` coverage | Moved planner tool guidance to registry definitions, tightened evidence anchors, added ordinary-word negative tests, added provider-schema/export assertions, and added template/workflow coverage |
| 2026-05-10 | Phase 3 re-review | Codex subagents: architecture/runtime, safety/trust, testing/QA | [x] Passed | No remaining P0/P1/P2 findings after fixes | Proceeded to Obsidian smoke after focused, full, lint, type, build, and whitespace checks passed |
| 2026-05-10 | Phase 3 smoke | Live Obsidian test vault | [x] Passed | No P1/P2 smoke blockers found; app smoke covered current-note/frontmatter vault advice and metadata search boundaries | Recorded that explicit-rule/template evidence was covered by automated tests because the test vault has no dedicated rule/template fixture |
| 2026-05-10 | Phase 4 first slice | Codex subagents: architecture/runtime, provider/schema, safety/QA | [x] Fixed | P2: native capability validation treated missing `baseURL` as a wildcard, which could enable native tool calling for arbitrary OpenAI-compatible endpoints sharing provider/model strings | Made `NativeToolCallingValidation.baseURL` required, required exact normalized baseURL match, added custom-baseURL negative test, and re-reviewed to no actionable findings |
| 2026-05-10 | Phase 4 disabled-gate smoke | Live Obsidian test vault | [x] Passed | No P1/P2 smoke blockers found; deployed plugin reload kept normal JSON planner/Memory flow stable with native gate disabled | Continue with actual native execution loop only behind internal gate |
| 2026-05-10 | Phase 4 native loop | Codex subagents: architecture/runtime, provider/native shape, test coverage | [x] Passed | No P0/P1/P2 findings; native loop remains context/tool planning only, `ChatService` still owns final streaming, provider schema bind and fallback boundaries looked sound | Added mock native schema-bind/tool-execution coverage, invalid-args JSON fallback, and incomplete-native-planning JSON fallback before final answer output |
| 2026-05-10 | Phase 5 first slice | Codex subagents: rollout gate, diagnostics/privacy, test coverage | [x] Fixed | P2: fallback diagnostics redaction coverage did not yet include invalid native args/schema export failure sentinels; native-vs-JSON equivalence lacked a same-scenario read-only context comparison | Added privacy sentinel tests for invalid args and schema export failure, added same-scenario `search_vault_metadata` native-vs-JSON context equivalence test, and re-reviewed to no actionable findings |
| 2026-05-10 | Phase 5 smoke gate | Codex subagents: rollout/runtime gate, privacy/logging | [x] Passed | No P0/P1/P2 findings; one full-test migration save regression was found locally and fixed before commit | Kept default rollout table empty, added hidden local qwen smoke gate, hardened tool failure logs, and verified settings migration does not save merely because the hidden flag is absent |
| 2026-05-10 | Phase 5 rollout decision | Local go/no-go | [x] Superseded by qwen default follow-up | Initial decision deferred default rollout because openai/ollama remained unverified and qwen had only one real metadata-path smoke in that slice | Later qwen validation promoted qwen/qwen-plus/DashScope to the default table; openai/ollama remain deferred |
| 2026-05-10 | Phase 5 qwen default rollout | Codex subagents: runtime/fallback/privacy, docs/tracker | [x] Fixed | Runtime review found no P0/P1/P2; docs review found P2 stale wording around hidden smoke gate, default table state, and openai/ollama status | Fixed docs/tracker status drift, promoted qwen/qwen-plus/DashScope to default native planning, and kept openai/ollama on JSON fallback |
| 2026-05-10 | Phase 6 write handoff | Codex subagents: product/security, architecture/QA | [x] Fixed | P2: Phase 5 was marked done while a QA row still said in progress; Phase 6 handoff doc read as closed while tracker gates still said in progress/todo | Marked Phase 5 equivalence done-for-this-track with future provider work deferred; closed Phase 6 docs/test/review/smoke gates as docs-only handoff |

## Verification Log

| Date | Phase | Command / Smoke | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-10 | Initial tracker | `git diff --check` | [x] Passed | Tracked `docs/PLAN.md` diff had no whitespace errors after tracker creation |
| 2026-05-10 | Phase 0A | `rg -n "[[:blank:]]+$" docs/PLAN.md docs/vault-native-assistant-development-tracker.md docs/archive` | [x] Passed | No trailing whitespace matches across tracked and untracked Phase 0A docs |
| 2026-05-10 | Phase 0A | `git diff --check` | [x] Passed | Tracked diff whitespace check passed after Phase 0A review fixes |
| 2026-05-10 | Phase 0A | Obsidian smoke decision | [x] Skipped | Docs-only migration/fix; no Chat UI, runtime, Memory routing, ToolRegistry, native path, or lifecycle behavior changed |
| 2026-05-10 | Phase 0B | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 1 suite / 59 tests passed; warning: `--localstorage-file` without valid path |
| 2026-05-10 | Phase 0B | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 0B | `git diff --check` | [x] Passed | Tracked diff whitespace check passed after baseline inventory |
| 2026-05-10 | Phase 0B | `rg -n "[[:blank:]]+$" docs/PLAN.md docs/vault-native-assistant-development-tracker.md docs/archive` | [x] Passed | No trailing whitespace matches across tracked and untracked docs |
| 2026-05-10 | Phase 0B | Obsidian smoke decision | [x] Skipped | Docs-only baseline inventory; no runtime/UI behavior changed; Phase 1 will run `make deploy` and Obsidian smoke after intent routing lands |
| 2026-05-10 | Phase 1 | `npm test -- __tests__/chat-service.test.ts` | [x] Passed | 1 suite / 61 tests passed after intent-aware Memory routing; warning: `--localstorage-file` without valid path |
| 2026-05-10 | Phase 1 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 1 | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 1 | `git diff --check` | [x] Passed | Whitespace check passed after intent-aware Memory routing |
| 2026-05-10 | Phase 1 fix | `npm test -- __tests__/chat-service.test.ts __tests__/memory-manager.test.ts` | [x] Passed | 2 suites / 81 tests passed after classifier and Memory copy fixes; warning: `--localstorage-file` without valid path |
| 2026-05-10 | Phase 1 fix | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 1 fix | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 1 fix | `git diff --check` | [x] Passed | Whitespace check passed after review fixes |
| 2026-05-10 | Phase 1 smoke setup | `make deploy` | [x] Passed | Ran full Jest, lint, build, and copied `dist/main.js`, manifests, and `styles.css` into `test/.obsidian/plugins/personal-assistant/`; build emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 1 Obsidian smoke | Content question while Memory ready | [x] Passed | Asked `agent意图安全有几个阶段？只回答阶段数量。`; Thinking showed `Finding related memory` and real references (`2026-05-01.md`, `test/test1.md`, `Cat.md`, `About.md`); answer showed Memory references |
| 2026-05-10 | Phase 1 Obsidian smoke | Agent-control while Memory ready | [x] Passed | Asked `下一步`; Thinking showed only context/answer steps, with no Memory search, no confirmation, and no Memory references |
| 2026-05-10 | Phase 1 Obsidian smoke | Content question while Memory needs setup | [x] Passed | Reset local Memory copy through the product command; approval dialog showed Data, AI provider, Memory search, and Cost sections; `Answer now` continued without Memory and status remained `Memory needs setup` |
| 2026-05-10 | Phase 1 Obsidian smoke | Agent-control while Memory needs setup | [x] Passed | Asked `下一步`; no Memory confirmation appeared, Thinking showed only context/answer steps, and status remained `Memory needs setup` |
| 2026-05-10 | Phase 2 | `npm test -- __tests__/chat-view.test.ts --runInBand` | [x] Passed | 1 suite / 3 lifecycle tests passed after stale callback, AbortError, button-state, and rAF fixes |
| 2026-05-10 | Phase 2 | `npm test -- __tests__/chat-service.test.ts __tests__/chat-view.test.ts` | [x] Passed | 2 suites / 74 tests passed for chat-service and chat-view coverage |
| 2026-05-10 | Phase 2 | `npm test -- --runInBand` | [x] Passed | 19 suites / 190 tests passed |
| 2026-05-10 | Phase 2 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 2 | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 2 | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 2 smoke setup | `make deploy` | [x] Passed | Ran full Jest, lint, build, and copied `dist/main.js`, manifests, and `styles.css` into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-10 | Phase 2 Obsidian smoke | Initial controls after real reload | [x] Passed | Used command palette reload after deploy; initial state showed `Ask`, `Clear Chat`, disabled `Add to Editor`, and no visible cancel button after smoke fix |
| 2026-05-10 | Phase 2 Obsidian smoke | Clear chat during active generation | [x] Passed | Started a long response, clicked `Clear Chat`, waited, and no stale Thinking, chunk, or cancelled message returned |
| 2026-05-10 | Phase 2 Obsidian smoke | Cancel during final answer | [x] Passed | Cancelled a long streaming response; partial answer remained with `Generation cancelled`, Ask returned, and no later chunks appended |
| 2026-05-10 | Phase 2 Obsidian smoke | Rapid send after previous cancel | [x] Passed | Sent a new prompt after cancellation; new turn started normally and was independently cancellable |
| 2026-05-10 | Phase 2 Obsidian smoke | Early Memory/tool-stage cancellation boundary | [x] Covered by tests | UI smoke covered visible final-answer cancellation; automated AbortController/stale-callback tests cover stale status/chunk/write suppression across earlier agent stages |
| 2026-05-10 | Phase 2 final recheck | `npm test -- __tests__/chat-view.test.ts --runInBand` | [x] Passed | Re-run after tracker/smoke fixes; 1 suite / 3 tests passed |
| 2026-05-10 | Phase 2 final recheck | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 2 final recheck | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 2 final recheck | `git diff --check` | [x] Passed | Whitespace check passed for current Phase 2 diff |
| 2026-05-10 | Phase 3 | `npm test -- __tests__/chat-service.test.ts --runInBand` | [x] Passed | 1 suite / 77 tests passed after ToolRegistry metadata and vault-advice policy changes; warning: `--localstorage-file` without valid path |
| 2026-05-10 | Phase 3 | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 3 | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 3 | `git diff --check` | [x] Passed | Whitespace check passed after Phase 3 code/test fixes |
| 2026-05-10 | Phase 3 | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 3 | `npm test -- --runInBand` | [x] Passed | 19 suites / 196 tests passed |
| 2026-05-10 | Phase 3 smoke setup | `make deploy` | [x] Passed | Ran full Jest, lint, build, and copied `dist/main.js`, manifests, and `styles.css` into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-10 | Phase 3 Obsidian smoke | Current-note/frontmatter vault advice | [x] Passed | Asked for 3 vault organization suggestions based on the current `0.unsorted/Dog.md` note and frontmatter/tags; Thinking showed Memory search plus current-note metadata read, and the answer said no explicit rule/template/workflow evidence was found, did not call the advice a user preference/rule, and did not claim command execution |
| 2026-05-10 | Phase 3 Obsidian smoke | Metadata search with vault advice boundary | [x] Passed | Asked for dog/canine tag/frontmatter related notes and 2 general suggestions; Thinking/answer used `search_vault_metadata`, listed `0.unsorted/Dog.md`, `Cat.md`, and `About.md`, preserved general-advice wording, and did not claim preferences/rules or command execution |
| 2026-05-10 | Phase 3 Obsidian smoke | Explicit-rule/template evidence fixture | [x] Covered by tests | The current test vault has no dedicated rule/template note fixture; automated tests cover `explicit_rule`, `template_or_workflow`, ordinary factual notes, fake refs, command text, and write-injection attempts |
| 2026-05-10 | Phase 4 first slice | `npm test -- __tests__/ai-utils.test.ts __tests__/chat-service.test.ts --runInBand` | [x] Passed | 2 suites / 84 tests passed after capability gate, schema export, native tool-call fixtures, and baseURL wildcard fix; warning: `--localstorage-file` without valid path |
| 2026-05-10 | Phase 4 first slice | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 4 first slice | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 4 first slice | `git diff --check` | [x] Passed | Whitespace check passed |
| 2026-05-10 | Phase 4 first slice | `npm test -- --runInBand` | [x] Passed | 20 suites / 202 tests passed before baseURL fix; `make deploy` later re-ran full Jest with 20 suites / 203 tests |
| 2026-05-10 | Phase 4 first slice | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 4 smoke setup | `make deploy` | [x] Passed | Ran full Jest 20 suites / 203 tests, lint, build, and copied `dist/main.js`, manifests, and `styles.css` into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-10 | Phase 4 Obsidian smoke | Disabled native gate keeps JSON planner stable | [x] Passed | Reloaded the app after deploy, asked `What notes in this vault mention dog or canine? Answer in one sentence.`; Thinking showed normal Memory/answer flow, final answer completed with Memory references, and no native/tool-call UI behavior changed |
| 2026-05-10 | Phase 4 native loop | `npm test -- __tests__/chat-service.test.ts __tests__/ai-utils.test.ts --runInBand` | [x] Passed | 2 suites / 87 tests passed after native loop and fallback-before-final-action test |
| 2026-05-10 | Phase 4 native loop | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 4 native loop | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 4 native loop | `git diff --check` | [x] Passed | Whitespace check passed |
| 2026-05-10 | Phase 4 native loop | `npm test -- --runInBand` | [x] Passed | 20 suites / 206 tests passed |
| 2026-05-10 | Phase 4 native loop | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 4 native loop smoke setup | `make deploy` | [x] Passed | Ran full Jest 20 suites / 206 tests, lint, build, and copied `dist/main.js`, manifests, and `styles.css` into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-10 | Phase 4 native loop Obsidian smoke | Disabled native gate keeps JSON planner stable after native loop landed | [x] Passed | Reloaded Obsidian after deploy, asked `What notes in this vault mention dog or canine? Answer in one sentence.`; Thinking showed related Memory search, `search_memory: dog OR canine`, and Answering; final answer cited `0.unsorted/Dog.md` with Memory references and no native UI behavior change |
| 2026-05-10 | Phase 5 first slice | `npm test -- __tests__/ai-utils.test.ts __tests__/chat-service.test.ts --runInBand` | [x] Passed | 2 suites / 91 tests passed after empty rollout table, redacted diagnostics, fallback redaction, and native-vs-JSON equivalence coverage |
| 2026-05-10 | Phase 5 first slice | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 5 first slice | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 5 first slice | `git diff --check` | [x] Passed | Whitespace check passed |
| 2026-05-10 | Phase 5 first slice | `npm test -- --runInBand` | [x] Passed | 20 suites / 210 tests passed |
| 2026-05-10 | Phase 5 first slice | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 5 smoke gate | `npm test -- __tests__/plugin-record-note.test.ts __tests__/ai-utils.test.ts __tests__/chat-service.test.ts --runInBand` | [x] Passed | 3 suites / 102 tests passed after hidden smoke flag and migration fix |
| 2026-05-10 | Phase 5 smoke gate | `npm test -- --runInBand` | [x] Passed | 20 suites / 213 tests passed |
| 2026-05-10 | Phase 5 smoke gate | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 5 smoke gate | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 5 smoke gate | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 5 smoke gate | `git diff --check` | [x] Passed | Whitespace check passed before smoke |
| 2026-05-10 | Phase 5 smoke setup | `make deploy` | [x] Passed | Ran full Jest 20 suites / 213 tests, lint, build, and copied plugin assets into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-10 | Phase 5 Obsidian smoke | Hidden opt-in qwen native metadata path | [x] Passed | Temporarily set ignored `nativeToolPlanningSmokeEnabled=true`, reloaded Obsidian, asked for notes with tag `canine-variety`; Thinking showed metadata search and `Found 1 metadata match(es).: 0.unsorted/Dog.md`, final answer was `0.unsorted/Dog.md`, and no fallback status appeared |
| 2026-05-10 | Phase 5 Obsidian smoke cleanup | Restore hidden smoke flag | [x] Passed | Restored ignored test vault `data.json` to the pre-smoke state by removing the temporary hidden flag |
| 2026-05-10 | Phase 5 qwen default rollout | `npm test -- __tests__/ai-utils.test.ts __tests__/chat-service.test.ts --runInBand` | [x] Passed | 2 suites / 95 tests passed after default qwen rollout and default-gate coverage |
| 2026-05-10 | Phase 5 qwen default rollout | `npx tsc -noEmit -skipLibCheck` | [x] Passed | No type errors |
| 2026-05-10 | Phase 5 qwen default rollout | `npm run lint` | [x] Passed | ESLint passed |
| 2026-05-10 | Phase 5 qwen default rollout | `git diff --check` | [x] Passed | Whitespace check passed |
| 2026-05-10 | Phase 5 qwen default rollout | `npm test -- --runInBand` | [x] Passed | 20 suites / 214 tests passed |
| 2026-05-10 | Phase 5 qwen default rollout | `npm run build` | [x] Passed | Build passed; emitted only Browserslist stale-data warning |
| 2026-05-10 | Phase 5 qwen default smoke setup | `make deploy` | [x] Passed | Ran full Jest 20 suites / 214 tests, lint, build, and copied plugin assets into `test/.obsidian/plugins/personal-assistant/` |
| 2026-05-10 | Phase 5 qwen default Obsidian smoke | Default qwen native metadata path | [x] Passed | With `nativeToolPlanningSmokeEnabled=false`, reloaded Obsidian, asked for notes with tag `canine-variety`; Thinking showed metadata search and `Found 1 metadata match(es).: 0.unsorted/Dog.md`, final answer was `0.unsorted/Dog.md`, and no fallback status appeared |
| 2026-05-10 | Phase 6 docs draft | `docs/write-action-design-handoff.md` | [x] Passed | Drafted write-action boundary, preview/confirm gates, local-only redacted audit contract, runtime boundary, test matrix, and open decisions |
| 2026-05-10 | Phase 6 docs check | `git diff --check -- docs/PLAN.md docs/vault-native-assistant-development-tracker.md docs/write-action-design-handoff.md` | [x] Passed | Docs whitespace check passed after handoff draft |
| 2026-05-10 | Phase 6 Obsidian smoke decision | Docs-only handoff | [x] Skipped | No Chat UI, runtime, Memory routing, ToolRegistry/native path, lifecycle behavior, or write prototype changed |

## Risk Register

| Risk | Severity | Phase | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Agent-control intent accidentally triggers Memory search/cost | P1 | Phase 1 | Intent routing tests and Obsidian smoke covered ready and not-ready states | [x] Mitigated |
| Core/native path creates a second final streaming owner | P1 | Phase 2/4 | `ChatService` remains final streaming owner; `AgentTurnPlan` only wraps prompt planning; subagent architecture review passed | [x] Mitigated for Phase 2 |
| Stale status/chunk updates cleared or cancelled chat | P1 | Phase 2 | `sessionId/turnId` active turn guard, AbortError tests, rAF cleanup tests, and Obsidian clear/cancel smoke | [x] Mitigated |
| Cancel button visible while no generation is active | P2 | Phase 2 | Explicit hidden class plus scoped CSS specificity; Obsidian reload smoke verified initial controls | [x] Mitigated |
| Tool metadata diverges between JSON and native path | P2 | Phase 3/4/5 | ToolRegistry now stores schema/policy/budget/source-boundary metadata, exports provider schemas, JSON/native paths share registry semantics, and qwen default rollout smoke passed metadata tool context without fallback | [x] Mitigated for current qwen default rollout |
| Vault advice upgrades ordinary notes into user preferences | P2 | Phase 3 | Strict `vault_advice_context` evidence classification, prompt policy, prompt-injection fixtures, subagent safety review, and Obsidian smoke | [x] Mitigated |
| Planner prompt duplicates tool metadata outside registry | P2 | Phase 3 | Removed hardcoded registered-tool examples from planner system prompt and asserted registry-derived tool definitions in tests | [x] Mitigated |
| Native capability allowlist accidentally wildcards custom baseURL | P2 | Phase 4 | `NativeToolCallingValidation.baseURL` is required, matching uses normalized exact baseURL, and custom OpenAI-compatible baseURL negative test covers the regression | [x] Mitigated |
| Native fallback replays answer after visible chunk | P1 | Phase 4 | Native planning fallback happens inside `planTurn` before final answer output; `ChatService.canFallbackToNonStreaming` still forbids non-streaming replay after visible chunks | [x] Mitigated |
| Diagnostics or write audit records private note paths/content | P2 | Phase 5/6 | Phase 5 native diagnostics and tool failure logs are redacted and covered by prompt/path/token/sentinel tests; Phase 6 did not add runtime writes and future write audit requires separate review | [x] Mitigated for current track |
| Archived docs accidentally treated as active source | P2 | Phase 0A | Archive banners point to PLAN and this tracker; compact evidence summary marks archive as historical only | [x] Mitigated |
| Untracked Phase 0A docs missed by tracked diff whitespace check | P2 | Phase 0A | Run explicit trailing-whitespace scan across `docs/PLAN.md`, tracker, and `docs/archive` | [x] Mitigated |
| Phase label drift mixes intent routing with turn lifecycle | P2 | Phase 0B | PLAN now assigns `AgentEvent` / turn lifecycle wording to Phase 2 | [x] Mitigated |

## Open Decisions

| Decision | Needed By | Status | Notes |
| --- | --- | --- | --- |
| Branch name for implementation | Before Phase 1 dev | [x] Done | Current branch: `codex/chat-agent-next-refactor-plan` |
| Whether to create a separate implementation tracker per phase | Before large implementation | [x] Not needed | Current tracker covered all phases through Phase 6 |
| Provider smoke availability for `openai` / `qwen` / `ollama` | Phase 5 | [x] Decided for this track | qwen/qwen-plus/DashScope hidden opt-in and default native smoke passed; openai/ollama remain unverified and deferred to JSON planner fallback |

## Final Completion Criteria

The refactor track is complete only when:

- All phases through the chosen rollout boundary are marked `[x]`.
- Each phase has dev, test, subagent review, fix, Obsidian smoke, and final fix records.
- `npm test -- __tests__/chat-service.test.ts`, `npm test -- --runInBand`, `npx tsc -noEmit -skipLibCheck`, `npm run lint`, `npm run build`, and `git diff --check` pass for runtime-affecting phases.
- Obsidian smoke evidence is recorded for UI/runtime phases.
- No P1/P2 findings remain unresolved unless explicitly deferred by the user.
