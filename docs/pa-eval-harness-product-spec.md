# PA Eval Harness Product Spec

Updated: 2026-06-28

## Status

| Field | Value |
| --- | --- |
| Document type | Product/engineering spec / future implementation input |
| Status | Confirmed decision spec; implementation not started |
| Feature family | Eval Harness / Replay Evaluation |
| Primary scope | Retrieval, Memory, Maintenance action |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [Context Pager spec](./pa-context-pager-product-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Pagelet Trust Layer spec](./pagelet-trust-layer-product-spec.md), [Pagelet Maintenance Review spec](./pagelet-maintenance-review-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md) |

This spec defines PA's repo-local evaluation harness. It is not current shipped
behavior.

The harness exists to keep PA's evidence, memory, and action systems reliable
as retrieval, Pagelet, Memory, Maintenance, and graph-aware discovery evolve.

## Confirmed Decisions

| ID | Decision | Product/engineering consequence |
| --- | --- | --- |
| EVAL-D1 | Build a repo-local small fixture harness, not a full benchmark system first. | Start with focused, maintainable fixtures that protect core PA risks. |
| EVAL-D2 | v1 covers retrieval + memory + maintenance action. | Evaluate grounded sources, no-answer/conflict/privacy, memory admission, and action preview/rollback. |
| EVAL-D3 | Use B+ layered evaluation. | Deterministic gates first; optional semantic judge second; user outcome metrics third. |
| EVAL-D4 | Use an independent repo-local synthetic test vault. | Do not rely on the mutable `test/` vault for evaluation fixtures. |
| EVAL-D5 | Integrate in layers. | Fast deterministic subset can gate CI/pre-release; full deterministic and LLM judge run manually/nightly. |
| EVAL-D6 | Eval Harness needs its own spec. | It crosses Active Vault Indexer, Trust Layer, Maintenance Review, and Graph Discovery. |
| EVAL-D7 | Maintain a cross-spec deterministic coverage matrix. | Each product spec that relies on evidence, memory, context, privacy, or actions declares the hard checks that block its implementation phase. |

## 1. Product Decision

Eval Harness should be a first-class PA capability, but v1 should be small and
hard rather than broad and benchmark-like.

Core decision:

> PA needs repo-local fixtures that prove evidence, memory, and actions respect
> product boundaries before semantic quality scoring is considered.

## 2. Product Principles

### 2.1 Deterministic Correctness First

Some risks must be proven with deterministic assertions:

- excluded folders are not used
- sourceRefs point to existing notes/blocks
- retrieval outcomes return the expected state
- Memory Candidates do not become Confirmed Memory without user confirmation
- stale/conflicting memory is not silently overwritten
- action preview contains affected paths and diffs
- rollback restores the expected state
- provider/scope boundaries are respected

These are hard gates.

### 2.2 Semantic Judgment Second

LLM judge can help evaluate meaning and usefulness:

- groundedness
- insight usefulness
- summary completeness
- conflict explanation quality
- memory worthiness
- why-shown clarity

But LLM judge must not be the first or only safety gate.

### 2.3 User Outcome Third

Real product feedback should calibrate the harness over time:

- accepted / dismissed
- edit-before-confirm
- undo rate
- source click-through
- wrong-context report
- not useful feedback

### 2.4 Small Fixtures Beat Big Benchmarks In V1

Public benchmarks do not prove PA works inside a personal Obsidian vault. v1
should use a small synthetic vault that captures PA-specific failure modes.

## 3. Evaluation Layers

| Layer | Purpose | Blocking? | Run mode |
| --- | --- | --- | --- |
| deterministic hard gates | correctness, privacy, state, lifecycle, rollback | yes for selected subset | CI / pre-release |
| full deterministic suite | broader fixture coverage | yes for release/manual gates when selected | manual / nightly |
| optional LLM judge | semantic quality signals | no | manual / nightly |
| product outcome metrics | real usage calibration | no by default | telemetry/local review |

Rule:

> Deterministic gates decide pass/fail. Semantic judges provide quality signals.
> User outcomes calibrate what matters.

## 4. V1 Fixture Categories

Eval Harness v1 covers three domains.

### 4.1 Retrieval

Fixture categories:

- grounded QA / citation correctness
- no-answer / partial / conflict
- excluded folder leakage
- sourceRef existence
- structure rerank sanity
- broad retrieval scope plan

Example hard assertions:

- expected source path appears
- excluded source path never appears
- `no_evidence` query does not produce `evidence_found`
- conflict fixture returns conflict status
- sourceRefs resolve to real fixture files

### 4.2 Memory

Fixture categories:

- memory candidate admission
- stale memory
- conflicting memory
- Context Firewall auto/include/ask/drop
- high-sensitivity inference suppression
- Memory lifecycle state transitions

Example hard assertions:

- candidate has sourceRefs
- candidate is not Confirmed Memory until confirmed
- stale memory is not auto-included without gate result
- conflicting memory creates a conflict item
- private source does not generate candidate

### 4.3 Maintenance Action

Fixture categories:

- rename preview
- move preview
- archive preview
- link insertion/removal preview
- frontmatter/status patch preview
- content patch preview
- rollback/recover path

Example hard assertions:

- preview contains old/new path where relevant
- affected files are listed
- apply changes only selected actions
- rollback restores source files
- hard delete is not allowed
- source note changes produce action log/recovery metadata

## 4.4 Cross-spec Coverage Matrix

This matrix is the first implementation planning contract. It should be updated
when a product spec adds a new hard boundary.

| Spec / surface | Deterministic checks | Blocks |
| --- | --- | --- |
| Product IA / Review Queue | canonical queue type accepted; unknown type rejected; required shared fields present | Shared Review Queue data model |
| Active Vault Indexer | sourceRefs resolve; excluded paths absent; retrieval outcome status matches fixture; replay source refs omit private excerpts | Retrieval substrate phase |
| Data Boundary | excluded/generated/self-write sources do not reach provider/candidate paths; per-run override recorded; cleanup groups separate cache/user data | Any provider-backed broad scan or memory extraction |
| Context Pager | displayed used/skipped/dropped counts match retrieval/memory outcomes; why-dropped labels match actual decision reasons | Context transparency UI |
| Pagelet Trust Layer | Memory Candidate has sourceRefs/type/scope/sensitivity; high-sensitivity inference suppressed; conflict creates review item | Memory admission flow |
| Memory Type Taxonomy | candidate uses canonical memory type; archive/forget/export transitions preserve lifecycle contract; tombstone has no raw text | Memory panel / Confirmed Memory |
| Maintenance Review | preview includes affected paths/diff/reason; forbidden action rejected; apply selected only; undo/recovery metadata present | Any source-note mutation |
| Quick Capture | capture writes original user note; AI expansion separated; task/memory suggestions stay queue-only until confirmed | Quick Capture AI post-processing |
| Quiet Recall | no nudge when evidence is weak or stale; bonus far association cannot outrank explicit current relevance | Recall nudges |
| Saved Insight Ledger | PA-generated insight has sourceRefs; user-authored insight marked unsourced/user-authored; promotion creates explicit target item | Insight save/promotion |
| Scope Recap / Theme Summary | important claim has sourceRefs; stale recap flagged; generated recap not used as source unless policy allows | Recap generation/write |
| Weekly Review | scope disclosure present; accepted-only items enter Markdown note; dismissed/unconfirmed items stay out | Weekly Review write |
| Lightweight Graph Discovery | graph suggestions have sourceRefs; `theme_chain` does not become memory directly; rejected edge remains local | Graph-aware discovery |
| Retrieval Habit Profile | disabled mode has no influence; weak signal cannot cross explicit scope/Data Boundary/evidence strength | Retrieval adaptation |

Blocking rule:

> A feature phase cannot claim product-spec compliance until its row's hard
> deterministic checks exist or the row is explicitly deferred in the phase SDD.

## 5. Synthetic Test Vault

Use an independent repo-local synthetic test vault. Do not use the existing
`test/` vault as the eval fixture source, because smoke testing and manual
experimentation can mutate it.

Recommended location:

```text
__fixtures__/pa-eval-vault/
```

Recommended structure:

```text
__fixtures__/pa-eval-vault/
  inbox/
  projects/
    pa-agent/
  private/
  daily/
  archive/
  pagelet-generated/
```

Fixture contents should include:

- tagged notes
- linked/backlinked notes
- aliases
- stale decision notes
- conflicting decision/status notes
- memory candidate sources
- maintenance action targets
- excluded/private notes
- daily notes with mixed topics
- archive candidates

Synthetic vault rules:

- keep small and readable
- stable paths
- no real user data
- deterministic expected outputs
- fixtures document why each note exists
- never rely on provider calls for hard gates

## 6. Expected Output Artifacts

Each fixture should define expected output in structured form.

Suggested layout:

```text
__fixtures__/pa-eval/
  cases/
    retrieval-grounded-qa.json
    retrieval-no-evidence.json
    memory-conflict.json
    maintenance-rename-rollback.json
  vault/
    ...
```

Case shape:

```text
EvalCase
  id
  domain
  taskKind
  input
  expected
  fixturePaths
  assertions
  judgeOptional
```

Assertion examples:

- `must_include_source`
- `must_not_include_source`
- `status_equals`
- `source_ref_exists`
- `memory_state_equals`
- `action_preview_contains`
- `rollback_restores`
- `hard_delete_forbidden`

## 7. LLM Judge Layer

LLM judge is optional and non-blocking in v1.

Allowed use:

- manual quality review
- nightly quality report
- regression investigation
- product research

Not allowed:

- hard CI gate
- privacy-sensitive real vault judging without explicit user/provider scope
- replacing deterministic assertions

Judge dimensions:

- groundedness
- usefulness
- completeness
- insight novelty
- conflict quality
- memory worthiness
- why-shown clarity

Judge output should be reported separately from deterministic pass/fail.

## 8. Development Integration

Recommended commands:

```text
npm run eval:pa:fast
npm run eval:pa:full
npm run eval:pa:judge
```

Integration policy:

| Mode | Runs | Blocking |
| --- | --- | --- |
| PR / fast CI | fast deterministic subset | yes when enabled |
| pre-release | fast + selected full deterministic | yes when selected |
| manual development | full deterministic | developer choice |
| nightly/manual quality | full deterministic + optional LLM judge | report only for judge |

`eval:pa:fast` should stay small enough to run frequently.

`eval:pa:judge` may require provider credentials and must be skipped cleanly
when unavailable.

## 9. Replay Evaluation

Replay Trace from Active Vault Indexer and Trust Layer should feed eval.

Replay should help answer:

- Which sources were used?
- Which sources were skipped?
- Which Memory was included or dropped?
- What retrieval outcome was returned?
- Which action preview was shown?
- What changed during apply?
- Was rollback/recovery possible?

Replay fields useful for eval:

- item id / answer id
- task kind
- scope
- selected sources
- skipped sources
- retrieval outcome status
- memory gate result
- action preview metadata
- apply result
- rollback result
- provider/model when applicable
- latency/cost when applicable

## 10. Metrics

Deterministic metrics:

- pass/fail by domain
- sourceRef resolution rate
- excluded path leakage count
- no-answer calibration
- conflict fixture pass rate
- memory lifecycle pass rate
- action rollback pass rate
- replay completeness

Semantic judge metrics:

- groundedness score
- usefulness score
- completeness score
- conflict explanation score
- why-shown clarity score

Product outcome metrics:

- accept/dismiss rate
- edit-before-confirm rate
- undo rate
- source click-through
- wrong-context reports
- not useful feedback

## 11. Phased Roadmap

### Phase 0: Product Contract

Status: this document.

- Define evaluation layers.
- Define v1 domains.
- Define synthetic vault requirement.
- Define command/run policy.

### Phase 1: Synthetic Vault + Retrieval Fixtures

- Create small synthetic vault.
- Add grounded QA, no-evidence, conflict, and excluded-folder cases.
- Add deterministic assertion runner.
- Add `eval:pa:fast` for retrieval subset.

### Phase 2: Memory Fixtures

- Add memory candidate, stale memory, conflict memory, and Context Firewall cases.
- Assert lifecycle states and sourceRefs.

### Phase 3: Maintenance Action Fixtures

- Add preview/rollback fixtures for rename, move, archive, link, frontmatter,
  and content patch.
- Assert no hard delete and recoverability.

### Phase 4: Replay Trace Integration

- Connect eval runner to Replay Trace output shape.
- Assert replay completeness for key fixtures.

### Phase 5: Optional LLM Judge

- Add non-blocking judge runner.
- Generate manual/nightly quality report.
- Keep provider absence as skipped, not failed, unless explicitly requested.

### Phase 6: User Outcome Calibration

- Use accepted/dismissed/edited/undo feedback to refine fixtures and weights.
- Keep privacy-safe aggregation boundaries.

## 12. Open Questions

- Should the synthetic vault live under `__fixtures__/pa-eval-vault/` or
  `test/eval-vault/`?
- Which retrieval fixture should be the first hard gate?
- Should eval cases be JSON, Markdown frontmatter, or TypeScript builders?
- Should `eval:pa:fast` run in the same Jest process or a separate runner?
- How much Replay Trace must exist before Phase 1 can start?

## 13. Non-goals

- No full public benchmark suite in v1.
- No LLM judge as hard CI gate.
- No real user vault data in fixtures.
- No provider requirement for deterministic hard gates.
- No attempt to score every possible insight quality dimension in v1.
- No replacement for Obsidian UI smoke tests.

## 14. Summary

PA Eval Harness protects the trust layer of the product.

The intended shape is:

- small repo-local synthetic vault
- deterministic hard gates for retrieval, memory, and maintenance action
- optional LLM judge for semantic quality reports
- user outcome metrics for long-term calibration
- layered CI/manual/nightly integration
- replay-aware assertions

This gives PA an engineering spine for trustworthy personal memory and action,
without pretending that public benchmarks alone prove product reliability.
