# PA Agent Control Policy Development Tracker

## Purpose

This tracker records SPEC-driven implementation status for [SDD: PA Agent Control Policy](./pa-agent-control-policy-sdd.md).

The architecture/product source of truth is [PA Agent Control Policy And Latency Optimization Plan](../pa-agent-latency-optimization-plan.md). The SDD is the implementation contract. This tracker is the execution record. If they drift, update all affected docs before continuing runtime work.

## Status Legend

| Marker | Meaning |
| --- | --- |
| `[ ]` | Todo |
| `[~]` | In progress |
| `[x]` | Done |
| `[d]` | Deferred with recorded rationale |
| `[!]` | Blocked |

## Required Delivery Loop

Every runtime SPEC follows:

```mermaid
flowchart LR
  Dev["dev"] --> Test["focused tests"]
  Test --> Review["review"]
  Review --> Fix["fix P0/P1/P2"]
  Fix --> Deploy["make deploy"]
  Deploy --> Smoke["Obsidian smoke"]
  Smoke --> Evidence["tracker evidence"]
```

Docs-only SPECs may skip deploy/smoke, but this tracker must state why.

## Current Status

| Item | Status |
| --- | --- |
| Created | 2026-06-07 |
| Current phase | Closeout complete for SPEC-00 through SPEC-04; SPEC-05 deferred |
| Current status | [x] Control-policy architecture implemented and validated; weather latency residual recorded for SPEC-05 rather than hidden as a host constraint |
| Source plan | `docs/pa-agent-latency-optimization-plan.md` |
| SDD | `docs/pa-agent-control-policy-sdd.md` |
| Runtime implementation | [x] SPEC-01 control snapshot plumbing, SPEC-02 metrics, SPEC-03 source-scoped exposure, and SPEC-04 answer-ready/follow-up controls implemented |
| Worktree strategy | [x] Used one integration worktree; parallel worktrees deferred because `pa-agent-loop.ts` and `pa-agent-runtime.ts` stayed shared hot spots |

## SPEC Index

| SPEC | Goal | Status | Owner Areas | Exit Gate |
| --- | --- | --- | --- | --- |
| SPEC-00 | SDD and tracker gate | [x] Done | docs | SDD/tracker reviewed; docs checks pass; runtime work approved to start |
| SPEC-01 | Control snapshot foundation | [x] Done | `pa-agent-loop.ts`, `pa-agent-runtime.ts`, new policy types/tests | Snapshot reaches model input and timing without behavior drift |
| SPEC-02 | Observability and latency metrics | [x] Done | timing/event diagnostics/tests | Timing explains tool exposure, model input size, tool outcomes, and end-to-end loop timing |
| SPEC-03 | Semantic-first and source-scoped exposure | [x] Done | runtime schema filtering, tool-definition filtering, preflight, router mapping | Tool exposure matches source scope and high-confidence route rules |
| SPEC-04 | Observation ledger, answer-ready, and guardrails | [x] Done | `pa-agent-control-policy.ts`, answer-completion helpers, tests | Useful observations enter answer-ready; guardrails handle duplicate/failure/budget cases |
| SPEC-05 | Latency levers after control correctness | [d] Deferred | batch execution audit, compact final-answer experiment, timing comparison | Weather residual recorded; direct-route/compact-answer requires separate decision |
| SPEC-06 | Review, smoke, and closeout | [x] Done | tests, docs, Obsidian smoke | No unresolved P0/P1/P2; smoke evidence recorded |

## Phase Ledger

| Phase | Scope | Status | Suggested Commit Scope |
| --- | --- | --- | --- |
| Phase 0 | Docs/spec gate | [x] Done | `docs(pa-agent): add control policy SDD and tracker` |
| Phase 1 | Control snapshot plumbing | [x] Done | `feat(pa-agent): add control policy snapshot` |
| Phase 2 | Timing and latency metrics | [x] Done | `feat(pa-agent): expose control timing diagnostics` |
| Phase 3 | Source-aware tool exposure | [x] Done | `feat(pa-agent): add source scoped tool exposure` |
| Phase 4 | Answer-ready and guardrails | [x] Done | `feat(pa-agent): add answer ready control guardrails` |
| Phase 5 | Measured latency levers | [d] Deferred | `perf(pa-agent): tune single fact response path` |
| Phase 6 | Smoke and closeout | [x] Done | `docs(pa-agent): close control policy tracker` |

## Worktree Parallelization

### Integration Worktree

```text
Path: /Users/edonyzpc/code/personal-assistant-pa-agent-optimization
Branch: codex/pa-agent-optimization-plan
Role: source-of-truth integration worktree
```

### Parallel Worktree Candidates

Do not create these until SPEC-01 lands and the shared interfaces are stable.

| Candidate branch | SPEC | File ownership | Can run in parallel with | Notes |
| --- | --- | --- | --- | --- |
| `codex/pa-agent-control-observability` | SPEC-02 | timing/event diagnostics, timing tests | SPEC-03 after interface freeze | Avoid policy semantics |
| `codex/pa-agent-control-exposure` | SPEC-03 | schema/tool-definition filtering, source-scope tests | SPEC-02 | High conflict risk with runtime |
| `codex/pa-agent-control-guardrails` | SPEC-04 | observation ledger, answer-ready, duplicate guardrails | none until SPEC-03 merges | Depends on source scopes |
| `codex/pa-agent-control-latency` | SPEC-05 | timing analysis, compact final-answer experiment, batch audit | SPEC-06 docs prep only | Direct-route requires separate decision |

Rules:

- Merge one SPEC back into the integration worktree before starting dependent SPECs.
- Never let two worktrees modify `pa-agent-loop.ts` interface shape at the same time.
- Re-run focused tests after each merge into integration.
- If a parallel branch finds it needs files owned by another branch, pause and re-plan instead of drifting.

## Phase Task Plan

### SPEC-00: SDD And Tracker Gate

Goal: lock implementation contract before runtime code changes.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Create SDD | docs | [x] Done | `docs/pa-agent-control-policy-sdd.md` records goals, contracts, SPECs, validation, and risks |
| dev | Create tracker | docs | [x] Done | This tracker records SPEC index, phase ledger, worktree plan, risks, and verification log |
| dev | Link source plan to SDD/tracker | docs | [x] Done | Latency/control plan points to this SDD and tracker |
| test | Docs whitespace checks | docs | [x] Done | `git diff --check` and trailing whitespace checks passed |
| review | Review docs | docs | [x] Done | No P0/P1/P2 doc contradictions before runtime work started |

Expected commands:

```bash
rg -n "[[:blank:]]+$" docs/pa-agent-control-policy-sdd.md docs/pa-agent-control-policy-development-tracker.md docs/pa-agent-latency-optimization-plan.md
git diff --check
git diff --no-index --check /dev/null docs/pa-agent-control-policy-sdd.md
git diff --no-index --check /dev/null docs/pa-agent-control-policy-development-tracker.md
```

### SPEC-01: Control Snapshot Foundation

Goal: introduce the policy seam with minimal behavior drift.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add control-policy module and types | `src/ai-services/pa-agent-control-policy.ts` | [x] Done | Exports exposure mode, source scope, snapshot, budget, diagnostics types |
| dev | Add snapshot to model input | `pa-agent-loop.ts` | [x] Done | Turn input carries current snapshot to `model.stream` |
| dev | Add initial and next snapshot flow | `pa-agent-runtime.ts`, loop policy bridge | [x] Done | Turn 0 and continued turns receive snapshots |
| test | Snapshot plumbing tests | `__tests__` | [x] Done | Tests prove snapshot reaches model input and timing metadata |
| review | Architecture review | runtime/policy | [x] Done | No hidden planner; behavior changes are constrained to exposure/admission and diagnostics |

Expected commands:

```bash
npm test -- __tests__/pa-agent-loop*.test.ts __tests__/pa-agent-runtime*.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
git diff --check
```

### SPEC-02: Observability And Latency Metrics

Goal: make later latency decisions evidence-driven.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add control snapshot timing fields | timing/events | [x] Done | Timing records exposure mode, source scope, allowed/blocked tools, budgets |
| dev | Add model/schema size metrics | runtime prompt/schema builder | [x] Done | Timing records input chars, schema count/size, tool-definition chars as non-warning `metrics` |
| dev | Add first-chunk timing fields | loop/model stream | [x] Done | Timing records first model chunk; finer final-answer delta fields are deferred to SPEC-05 |
| dev | Add agent-end timing and debug log | loop/runtime | [x] Done | `agent_end.metadata` and debug console expose `loopElapsedMs`, `turnTimings`, `endTiming`, startup phases, tool names, and tool outcomes |
| test | Timing tests | `__tests__` | [x] Done | Loop/control timing, runtime metrics helper, and chat-service lifecycle propagation covered |
| review | Timing review | runtime/tests | [x] Done | Timing records counts, sizes, tool names, outcomes, and snapshots; no prompt/schema bodies are logged |

Expected commands:

```bash
npm test -- __tests__/pa-agent-runtime*.test.ts __tests__/pa-agent-loop*.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
git diff --check
```

### SPEC-03: Semantic-First And Source-Scoped Exposure

Goal: apply source-aware tool exposure consistently.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add required-capability tool mapping | control/router | [x] Done | `webSearch`, `search_memory`, `get_current_note_context` map explicitly |
| dev | Add semantic-first tool set | control policy | [x] Done | Default low-confidence first turn exports only semantic source tools |
| dev | Add source-scoped exposure | control policy/runtime | [x] Done | notes-only/current-note-only/web-only scopes export correct tools |
| dev | Exclude low-level vault tools on first turn | exposure policy | [x] Done | `search_vault_snippets` appears only in Memory-requested follow-up; metadata/outline/inspect are not exposed by this follow-up path |
| test | Exposure and admission tests | `__tests__` | [x] Done | Provider schemas, textual definitions, and preflight stay aligned |
| review | Source boundary review | runtime/safety/tests | [x] Done | Notes-only and current-note-only smoke/tests do not admit web |

Expected commands:

```bash
npm test -- __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-runtime*.test.ts __tests__/pa-agent-loop*.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
git diff --check
```

### SPEC-04: Observation Ledger, Answer-Ready, And Guardrails

Goal: preserve model autonomy while stopping unproductive loops.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Add observation ledger | control policy | [x] Done | Answer-completion ledger remains active; full query-key ledger remains a SPEC-05/future enhancement once tools emit normalized query facts |
| dev | Add answer-ready mode | control policy/runtime instruction | [x] Done | Useful observations continue with answer-ready guidance, not forced final-only |
| dev | Add same-source follow-up admission | control policy | [x] Done | `needsSnippetFollowup` or equivalent opens targeted vault follow-up |
| dev | Add duplicate/no-op skip or reuse | executor preflight/control policy | [x] Done | Identical tool/source/query avoids real re-execution via existing duplicate preflight; control-snapshot rejection added |
| test | Guardrail tests | `__tests__` | [x] Done | Duplicate/failure/budget/final-only paths remain bounded |
| review | Control-policy review | runtime/policy/tests | [x] Done | Answer-ready preserves model autonomy; host only applies source, duplicate, failure, and budget guardrails |

Expected commands:

```bash
npm test -- __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-runtime*.test.ts __tests__/pa-agent-loop*.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
git diff --check
```

### SPEC-05: Latency Levers After Control Correctness

Goal: optimize measured latency without weakening autonomy or source boundaries.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| dev | Audit hybrid/parallel read-only batches | loop/tool execution | [d] Deferred | Needs a separate perf pass; current implementation already has deterministic parallel preflight tests |
| dev | Add compact final-answer experiment | runtime instruction/provider options | [d] Deferred | Do not ship without a product decision because it changes answer-turn autonomy |
| analyze | Compare p50/p95 samples | timing/smoke logs | [d] Deferred | Current smoke records representative single-run evidence; broader p50/p95 belongs to SPEC-05 |
| decision | Direct-route go/no-go | docs | [d] Deferred | Weather residual shows the opportunity; direct-route needs a focused SDD before implementation |
| review | Latency review | runtime/product/tests | [x] Done | Residual latency is documented as SPEC-05, not hidden in source-boundary policy |

Expected commands:

```bash
npm test -- __tests__/pa-agent-runtime*.test.ts __tests__/pa-agent-loop*.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
npm run lint
git diff --check
```

### SPEC-06: Review, Smoke, And Closeout

Goal: validate full behavior and close the tracker.

| Step | Task | Owner | Status | Acceptance |
| --- | --- | --- | --- | --- |
| test | Full focused PA Agent suite | tests | [x] Done | PA Agent policy/runtime/loop tests pass |
| test | Broad checks | repo | [x] Done | full Jest, typecheck, lint, build, and whitespace checks pass |
| deploy | Deploy to test vault | `make deploy` | [x] Done | Plugin assets copied to `test/.obsidian/plugins/personal-assistant/` after latest timing log change |
| smoke | Weather/current-info prompts | Obsidian test vault | [x] Done | Route/source behavior correct; residual 4-turn/3-webSearch latency recorded for SPEC-05 |
| smoke | Memory and notes-only prompts | Obsidian test vault | [x] Done | Notes-only smoke used only `search_memory`; no web/current-note drift |
| smoke | Common-knowledge prompt | Obsidian test vault | [x] Done | Prompt answered in one turn with zero tool calls in latest captured smoke |
| smoke | No-web/current-note prompt | Obsidian test vault | [x] Done | Prompt used only `get_current_note_context`; no `webSearch` |
| review | Final review | product/architecture/senior-engineering | [x] Done | No unresolved P0/P1/P2; SPEC-05 latency residual explicitly deferred |
| docs | Close tracker | docs | [x] Done | Verification log, review log, and risk register are current |

Expected commands:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run lint
npm run build
git diff --check
make deploy
```

## Risk Register

| Risk | Severity | Status | Mitigation |
| --- | --- | --- | --- |
| Control policy becomes a deterministic planner | High | Mitigated | Semantic-first remains model-selected by default; no broad Memory intent filters were added |
| Required-capability module keeps growing | High | Mitigated | `pa-agent-control-policy.ts` owns snapshots; required-capability remains router/compatibility logic |
| Schema/text/preflight filtering drift | High | Mitigated | One `AgentControlSnapshot` powers provider schemas, textual definitions, and executor admission; alignment tests added |
| Notes-only admits web/current-note | High | Verified | Notes-only smoke used only `search_memory`; no-web/current-note smoke used only `get_current_note_context` |
| Chinese no-web is bypassed by weather/current-info route | High | Fixed | Chinese explicit no-web suppresses `webSearch`; regression tests cover `不要联网，看一下杭州今天的天气` |
| Low-level vault tools become noisy in follow-up | Medium | Fixed | Same-source follow-up now exposes `search_vault_snippets` only and production Memory metadata is propagated into PA tool results |
| Stable common knowledge becomes over-blocked | Medium | Verified | Common-knowledge smoke answered with zero tools; unconstrained WebSearch remains allowed if the model chooses it |
| Debug metrics show as UI warnings | Medium | Fixed | Model-input metrics moved from `diagnostics` to non-warning `metrics`; UI warnings keep using true diagnostics/warnings |
| Hidden bad tool schema disables allowed tools | Medium | Fixed | Registry supports filtered provider schema export before `toProviderSchema()` runs |
| Skill catalog instructs unavailable `load_skill` | Medium | Fixed | `load_skill` is treated as a local meta-tool and remains exposed when the skill catalog is rendered |
| Weather/current-info still uses repeated WebSearch in answer-ready mode | Medium | Deferred | This is a SPEC-05 latency lever: direct-route, compact answer, or richer follow-up policy requires separate decision |
| Parallel worktrees create merge churn | Medium | Mitigated | One integration worktree was used because loop/runtime files stayed shared hot spots |
| Timing metrics leak content | Medium | Mitigated | Timing records counts/sizes/names/snapshots and not prompt text or serialized schemas |

## Review Log

| Date | SPEC | Reviewer | Status | Findings | Resolution |
| --- | --- | --- | --- | --- | --- |
| 2026-06-07 | SPEC-00 | Codex architecture review | Incorporated | Required-capability policy should not own control-policy behavior; latency levers need explicit ranking | SDD introduces `pa-agent-control-policy.ts`, worktree plan, and latency-specific implementation gates |
| 2026-06-07 | SPEC-01-SPEC-04 | Codex senior-engineering review | Passed | Control policy is source/admission oriented rather than a hidden planner; answer-ready preserves model autonomy | No P0/P1/P2 changes needed |
| 2026-06-07 | SPEC-06 | Obsidian smoke review | Passed with deferred perf item | Weather route is correct but answer-ready allowed two additional `webSearch` calls | Recorded as SPEC-05 latency work instead of adding a hidden anti-multi-turn constraint |
| 2026-06-07 | Post-closeout subagent review | Required fixes landed | Chinese no-web, UI warning leakage, hidden-schema export, `load_skill` mismatch, broad notes follow-up, air-quality route width, and SPEC-02 doc drift | Code/tests/docs updated; remaining weather repeated WebSearch remains SPEC-05 |

## Verification Log

| Date | SPEC | Command / Evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| 2026-06-07 | SPEC-00 | Create SDD and tracker | Passed | Docs added and source plan linked |
| 2026-06-07 | SPEC-00 | `rg -n "[[:blank:]]+$" docs/pa-agent-control-policy-sdd.md docs/pa-agent-control-policy-development-tracker.md docs/pa-agent-latency-optimization-plan.md` | Passed | No trailing whitespace matches |
| 2026-06-07 | SPEC-00 | `git diff --check` | Passed | No whitespace warnings |
| 2026-06-07 | SPEC-00 | `git diff --no-index --check /dev/null <new-doc>` for SDD, tracker, and latency plan | Passed | No whitespace warnings; command returns non-zero because the files are new or differ from `/dev/null` |
| 2026-06-07 | SPEC-01 | `npm test -- __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 1 suite passed, 58 tests passed; used ignored `node_modules` symlink to main worktree dependencies |
| 2026-06-07 | SPEC-01 | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 2 suites passed, 97 tests passed |
| 2026-06-07 | SPEC-01 | `npm test -- __tests__/pa-agent-runtime-tool-definitions.test.ts __tests__/pa-agent-runtime-prompt.test.ts __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 3 suites passed, 65 tests passed |
| 2026-06-07 | SPEC-01 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed after adding ignored `node_modules` symlink to local installed dependencies |
| 2026-06-07 | SPEC-01 | `git diff --check` | Passed | No whitespace warnings after SPEC-01 code changes |
| 2026-06-07 | SPEC-02 | `npm test -- __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 1 suite passed, 58 tests passed; loop timing and control snapshot metadata covered |
| 2026-06-07 | SPEC-02 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed with SPEC-02 loop timing metadata |
| 2026-06-07 | SPEC-02 | `git diff --check` | Passed | No whitespace warnings after SPEC-02 loop timing changes |
| 2026-06-07 | SPEC-02 | `npm test -- __tests__/pa-agent-loop.test.ts __tests__/pa-agent-runtime-tool-definitions.test.ts __tests__/chat-service.test.ts --runInBand` | Passed | 3 suites passed, 75 tests passed; diagnostic chunks, model-input metrics, and lifecycle propagation covered |
| 2026-06-07 | SPEC-02 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed with runtime model-input metrics |
| 2026-06-07 | SPEC-02 | `git diff --check` | Passed | No whitespace warnings after runtime metrics changes |
| 2026-06-07 | SPEC-03 | `npm test -- __tests__/pa-agent-loop.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-runtime-tool-definitions.test.ts --runInBand` | Passed | 3 suites passed, 78 tests passed; semantic-first, notes-only, and executor admission covered |
| 2026-06-07 | SPEC-03 | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-runtime-prompt.test.ts __tests__/pa-agent-runtime-tool-definitions.test.ts __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 4 suites passed, 108 tests passed |
| 2026-06-07 | SPEC-03 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed with source-scoped exposure |
| 2026-06-07 | SPEC-03 | `git diff --check` | Passed | No whitespace warnings after source-scoped exposure changes |
| 2026-06-07 | SPEC-04 | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 3 suites passed, 107 tests passed; answer-ready and metadata-driven notes follow-up covered |
| 2026-06-07 | SPEC-04 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed with answer-ready/follow-up controls |
| 2026-06-07 | SPEC-04 | `git diff --check` | Passed | No whitespace warnings after SPEC-04 changes |
| 2026-06-07 | SPEC-02 | `npm test -- __tests__/pa-agent-loop.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-runtime-tool-definitions.test.ts __tests__/chat-service.test.ts --runInBand` | Passed | 4 suites passed, 120 tests passed; `agent_end.metadata.turnTimings/endTiming` and debug timing plumbing covered |
| 2026-06-07 | SPEC-02 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed after adding required timing to test summary factories |
| 2026-06-07 | SPEC-06 | `npm test -- __tests__/pa-agent-loop.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-answer-completion-policy.test.ts __tests__/pa-agent-runtime-prompt.test.ts __tests__/pa-agent-runtime-tool-definitions.test.ts __tests__/chat-service.test.ts --runInBand` | Passed | 6 suites passed, 130 tests passed |
| 2026-06-07 | SPEC-06 | `npm test -- --runInBand` | Passed | 86 suites passed, 1593 tests passed |
| 2026-06-07 | SPEC-06 | `npm run lint` | Passed | ESLint passed for `src/**/*.{ts,tsx}` and `__mocks__/**/*.ts` |
| 2026-06-07 | SPEC-06 | `npm run build` | Passed | Initial sandbox run failed on `dist/` write permissions; escalated rerun passed with Browserslist outdated warning only |
| 2026-06-07 | SPEC-06 | `git diff --check` | Passed | No whitespace warnings |
| 2026-06-07 | SPEC-06 | `make deploy` | Passed | Escalated deploy passed: tests, lint, build, and copy to `test/.obsidian/plugins/personal-assistant/` completed |
| 2026-06-07 | SPEC-06 | Obsidian notes-only smoke after redeploy | Resolved setup issue | Obsidian restarted and latest plugin loaded; Computer Use initially reported inactive on click/set_value, and fallback coordinate clicks pasted into the note editor. Miswrites were undone, `test/obsidian-operations/snippet-smoke.md` content was verified clean, and later smoke runs passed. |
| 2026-06-07 | SPEC-03 | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts --runInBand` | Passed | 1 suite passed, 41 tests passed after adding Chinese current-info/weather high-confidence signals |
| 2026-06-07 | SPEC-03 | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed after high-confidence weather signal fix |
| 2026-06-07 | SPEC-06 | `make deploy` after high-confidence weather signal fix | Passed | Escalated deploy passed: full Jest, lint, build, and copy to test vault; Browserslist warning only |
| 2026-06-07 | SPEC-06 | Obsidian notes-only smoke `run_mq3hhklk_37ql0nk2` | Passed | `loopElapsedMs=12517`, `turnCount=2`, `toolCallCount=1`, `toolNames=['search_memory']`, `sourceScope='notes'`; final answer cited `2025-12-13.md` only |
| 2026-06-07 | SPEC-06 | Obsidian common-knowledge smoke `run_mq3hmiui_po453lia` | Passed | `loopElapsedMs=6662`, `turnCount=1`, `toolCallCount=0`; answered directly |
| 2026-06-07 | SPEC-06 | Obsidian weather smoke `run_mq3hr66m_4w9m2gfg` | Passed with SPEC-05 residual | `loopElapsedMs=38568`, `turnCount=4`, `toolCallCount=3`; turn 0 used `narrowed-required`, `sourceScope='web'`, `toolNames=['webSearch']`; answer-ready preserved model autonomy and allowed repeated WebSearch |
| 2026-06-07 | SPEC-06 | Obsidian no-web/current-note smoke `run_mq3hvwfg_jqqafaws` | Passed | `loopElapsedMs=7153`, `turnCount=2`, `toolCallCount=1`; turn 0 used `narrowed-required`, `sourceScope='current_note'`, `toolNames=['get_current_note_context']`; no `webSearch` |
| 2026-06-07 | Post-review fixes | `npm test -- __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-loop.test.ts __tests__/chat-service.test.ts __tests__/capability-registry.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-answer-completion-policy.test.ts --runInBand` | Passed | 6 suites passed, 187 tests passed; covers Chinese no-web, non-warning metrics, filtered schema export, `load_skill` meta exposure, and Memory follow-up metadata |
| 2026-06-07 | Post-review fixes | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed after post-review fixes |
| 2026-06-07 | Post-review no-web weather fix | `npm test -- __tests__/pa-agent-runtime-prompt.test.ts __tests__/chat-service.test.ts __tests__/pa-agent-required-capability-policy.test.ts __tests__/pa-agent-loop.test.ts --runInBand` | Passed | 4 suites passed, 128 tests passed; explicit no-web constraints now filter required capabilities, bound tools, and stale chat-history tool claims |
| 2026-06-07 | Post-review no-web weather fix | `npx tsc -noEmit -skipLibCheck` | Passed | TypeScript passed after prompt/history constraint fix |
| 2026-06-07 | Post-review no-web weather fix | `npm run lint` | Passed | ESLint passed for source and mocks |
| 2026-06-07 | Post-review no-web weather fix | `npm test -- --runInBand` | Passed | 86 suites passed, 1601 tests passed |
| 2026-06-07 | Post-review no-web weather fix | `make deploy` | Passed | Escalated deploy passed: full tests, lint, build, and copy to test vault; Browserslist warning only |
| 2026-06-07 | Post-review no-web weather fix | Obsidian smoke `run_mq3to7zk_k6evf694` | Passed | Prompt `不要联网，看一下杭州今天的天气`: `status='completed'`, `turnCount=2`, `toolNames=['search_memory','get_current_note_context']`, no `webSearch`, final answer does not claim `webSearch` is currently available |

## Smoke Matrix

| Prompt | Expected Source Scope | Expected Tool Behavior | Required Evidence |
| --- | --- | --- | --- |
| `看一下杭州今天的天气` | `web` | high-confidence route narrows to `webSearch`; answer-ready after result | timing shows route, schema count, tool execution, final answer |
| `不要联网，看一下杭州今天的天气` | no web | `webSearch` blocked even though weather route matches | exported/bound tool names exclude `webSearch` |
| `杭州现在气温多少` | `web` | same as weather/current-info | timing and web source records |
| `找一下周至擅长什么` | model-selected, likely `notes` | semantic-first first turn; low-level vault tools hidden unless follow-up | timing shows exposed tools and Memory observations |
| `找一下周至相关内容` | model-selected, likely `notes` | model may continue if context genuinely useful | continuation reason inferred from tool/source/query changes |
| `解释一下番茄工作法` | `none` or model-selected `web` | direct answer encouraged; WebSearch allowed if model chooses and budget allows | advisory timing if web is used |
| `只从我的笔记里找周至擅长什么` | `notes` | only notes-source tools; no web/current-note | source constraint and admission diagnostics |
| `不要联网，看当前笔记里有没有提到杭州天气` | `current_note` | no web; current-note tool allowed | hard no-web and current-note source scope |
| `结合我的笔记和网上资料，分析杭州今天出行是否合适` | `mixed` | multiple semantic sources allowed; no over-narrowing | source buckets remain separate |

## Smoke Results

| Prompt | Run ID | Result |
| --- | --- | --- |
| `只从我的笔记里找周至擅长什么` | `run_mq3hhklk_37ql0nk2` | Passed: 2 turns, 1 `search_memory`, notes-only source scope, no web/current-note drift |
| `解释一下番茄工作法` | `run_mq3hmiui_po453lia` | Passed: 1 turn, 0 tools |
| `看一下杭州今天的天气` | `run_mq3hr66m_4w9m2gfg` | Source routing passed: first turn narrowed to `webSearch`; latency residual remains because answer-ready allowed two more model-selected `webSearch` calls |
| `不要联网，看当前笔记里有没有提到杭州天气` | `run_mq3hvwfg_jqqafaws` | Passed: 2 turns, 1 `get_current_note_context`, no `webSearch` |
| `不要联网，看一下杭州今天的天气` | `run_mq3to7zk_k6evf694` | Passed: 2 turns, `search_memory` + `get_current_note_context`, no `webSearch`, no warning status, final answer no longer reuses stale tool-availability claims from chat history |
