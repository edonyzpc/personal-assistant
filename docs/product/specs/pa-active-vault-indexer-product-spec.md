# PA Active Vault Indexer Product Spec

Document status: Approved
Updated: 2026-08-30
Work item: B-125
Decision: [DEC-027 — 采用有界、汇合感知的检索恢复](../decisions/dec-027-bounded-retrieval-recovery.md)
Authority: Active Vault Indexer 的共享 retrieval behavior、surface policy、source/evidence contract 与 B-125 scoped requirements；早于 stable Backlog ID 的 bounded v1 baseline 继续保留其历史来源。

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Delivery status | Bounded v1 and AVI deepening slices have shipped. DEC-027/B-125 implementation and validation are closed；the owner approved rollout for all four internal flags on 2026-08-30, while the current source remains default-off pending a separately authorized shipping-default/release lane. See [B-125 closeout evidence](../../archive/2026/b-125-retrieval-optimization-closeout.md). |
| Primary surfaces | Chat, Pagelet, Memory, Maintenance Review |
| Feature family | Active Vault Indexer / Retrieval Substrate |
| Related research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [Context Pager spec](./pa-context-pager-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [Pagelet Trust Layer spec](../../archive/pagelet-trust-layer-product-spec.md), [Pagelet Maintenance Review spec](../../archive/pagelet-maintenance-review-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md) |
| Related runtime docs | [VSS SQLite/WASM architecture](../../architecture/vss-sqlite-wasm-architecture.md), [VSS local state plan](../../architecture/vss-local-state-plan.md), [Embedding refresh](../../architecture/vss-embedding-refresh.md), [PA Agent architecture](../../architecture/pa-agent-architecture-plan.md) |

This spec defines the product contract for PA's shared vault evidence substrate.
The bounded v1 and AVI deepening slices are implemented; future sections do not
expand the shipped runtime without a new SDD gate.

The Memory/VSS system provides local embedding/index infrastructure and
`Memory from your notes`. Active Vault Indexer is the product layer above that
foundation: it gives Chat, Pagelet, Memory, and Maintenance a shared way to
retrieve, rank, explain, and verify vault evidence.

This document reflects the one-question-at-a-time product decisions confirmed on
2026-06-28. It is now a durable contract for the implemented bounded slices;
explicit future scope still requires a new SDD. DEC-027 is a dated B-125 scoped
amendment；its target behavior is current product authority, and its closed delivery
evidence is retained only in the linked compact closeout record.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| AVI-D1 | Active Vault Indexer has no standalone user destination. | It appears through sources, scope, why-shown, and replay in Chat/Pagelet/Memory/Maintenance. |
| AVI-D2 | MVP lanes are Source + Semantic + Structure + Activity. Recap/theme lanes come later. | The first version uses original evidence, semantic retrieval, Obsidian structure, and current activity without introducing summary drift. |
| AVI-D3 | Structure and Activity participate in rerank and why-shown, but are not hard truth rules. | Folder/tag/link/backlink/recent signals improve ordering and explanation without replacing source evidence. |
| AVI-D4 | Broad, costly, or sensitive retrieval is plan-first via `Sources to check`. | Small scopes run directly; large or sensitive scopes show included/excluded sources before running. |
| AVI-D5 | Evidence-insufficient retrieval uses explicit statuses. | PA can answer with evidence, partial evidence, needs-scope, conflict, no-evidence, or blocked-by-privacy states. |
| AVI-D6 | Active Vault Indexer is shared across surfaces, with surface-specific policies. | Chat, Pagelet, Maintenance, Memory, Scope Recap, and periodic summaries share sourceRefs, exclusions, outcomes, why-shown, and replay metadata. |
| AVI-D7 | First implementation focus is substrate standardization, then Pagelet, then Chat. | Prioritize sourceRefs, retrieval outcomes, lanes, policies, exclusions, why-shown, and replay metadata first; after that, connect Pagelet, then Chat. |
| AVI-D8 | Reranker model selection is deterministic and invalid output fails open. | Use configured policy model, otherwise Chat model; only a valid explicit `none_relevant` can hide all candidates, so provider/parser failures do not manufacture no-evidence. |
| AVI-D9 | Structure retrieval uses additive Local、Deep Breadth and multi-seed Convergence lanes. | Complete one-hop semantic validation protects local recall；Top-3 distinct-note PPR preserves deeper breadth while rewarding notes supported by at least two seeds；semantic evidence and source validation remain mandatory. |
| AVI-D10 | Chat and Pagelet use Host-owned, run-scoped single recovery. | Chat automatically retries a valid miss once; Pagelet may use the same one-shot recovery to find a first or second independent insight and returns 0–2 insights rather than filling a quota. |
| AVI-D11 | B-125 ships the `CHAR-PHRASE` CJK lexical profile family. | Index and query share adjacency-preserving CJK character normalization. It prioritizes continuous-text lexical recall；Phase 0B must measure and contain substring-collision candidates through fusion/reranking rather than switching back to dictionary word boundaries without a new decision. |

## 1. Product Decision

Active Vault Indexer should be infrastructure, not a destination.

The user should not open an "Indexer", "RAG", "GraphRAG", or "Knowledge Graph"
page. Instead, the substrate should appear through ordinary PA surfaces:

- Chat answers with source-backed citations.
- Pagelet reviews show included/skipped sources and why-shown.
- Maintenance proposals show affected scope, source evidence, and impact.
- Memory candidates carry sourceRefs and conflict evidence.
- Broad vault questions show a sources-to-check plan before expensive or wide retrieval.

Core decision:

> Active Vault Indexer is PA's shared evidence substrate, not a new user-facing
> destination.

## 2. Product Principles

### 2.1 Source Is Truth, Structure Is Context

Obsidian structure is valuable, but it is not proof.

Folder, tag, link, backlink, alias, and recent activity signals should help PA
find and order evidence. Final claims must still ground back to source notes,
headings, blocks, or excerpts.

Rule:

> Structure is context, not truth. Source is truth.

### 2.2 Retrieval Is A Router, Not Top-K

PA should not treat `retrieve(k=5)` as the only retrieval strategy. Different
tasks need different retrieval policies, scopes, evidence thresholds, and
fallback behavior.

Rule:

> Semantic retrieves; structure and activity rerank and explain; source
> evidence grounds final output.

### 2.3 Broad Retrieval Is Plan-first

Small scopes can run immediately. Broad, costly, sensitive, or cross-vault-like
queries need a user-visible sources-to-check plan before provider calls or
large retrieval work.

Rule:

> PA proposes the scope, the user can adjust it, then PA runs.

### 2.4 Grounded Partial Answers Beat Fluent Unsupported Answers

If evidence is weak, PA should not bluff. It should answer with boundaries,
suggest widening scope, surface conflicts, or abstain.

Rule:

> Prefer grounded partial answers over fluent unsupported answers.

### 2.5 Shared Substrate, Surface-specific Policies

Chat, Pagelet, Memory, and Maintenance should share the same source model,
exclusion rules, sourceRefs, why-shown reasons, and replay metadata. But each
surface has different retrieval priorities.

Rule:

> Shared substrate, surface-specific retrieval policies.

## 3. MVP Evidence Lanes

MVP should include four lanes.

| Lane | Product question | MVP role |
| --- | --- | --- |
| Source lane | Where is the original evidence? | note path, heading/block, excerpt, sourceRefs, drill-down |
| Semantic lane | Which notes are meaningfully related? | embedding/BM25/hybrid candidates |
| Structure lane | How does the user's Obsidian structure shape relevance? | folder, tag, link, backlink, alias signals for rerank and explanation |
| Activity lane | Why is this relevant now? | current note, selected scope, recent edits, changed notes, review window |

MVP should not include full heavy graph products:

| Deferred lane | Stage | Reason |
| --- | --- | --- |
| Recap lane | P1 | folder/tag/scope summaries need source drill-down and drift controls |
| Theme/community lane | P1/P2 | useful for weekly/vault trends but high summary-drift risk |
| Entity graph lane | P2 | extraction cost and ontology mismatch |
| Graph visualization | P2 / likely no | attractive demo, weak core product value |

## 4. Retrieval Flow

Recommended high-level flow:

```text
User task
-> surface policy chooses retrieval mode
-> scope and exclusions resolved
-> candidate generation from semantic/BM25 + optional structure seeds
-> structure/activity rerank
-> source lane builds evidence packets
-> retrieval outcome produced
-> surface renders answer/review/proposal/memory candidate
-> replay trace records scope, sources, skipped sources, and decisions
```

Candidate generation:

- Semantic lane and BM25 find related content.
- Structure lane may add candidates from linked notes, backlinks, same tag, same folder, and aliases.
- Activity lane may add current note, selected notes, recently edited notes, or current review scope.

Rerank:

- Boost same folder, shared tag, backlink/outlink, alias, selected scope, and recent activity.
- Do not let structure override missing or weak source evidence.
- Excluded folders/tags are hard result/evidence filters, not rank penalties.
- For the B-125 model-assisted relevance gate, select the configured policy
  model or, only when none is configured, the Chat model. A rerank invokes one
  selected model; failure never cascades into a hidden second model call.
- Only a structurally valid, explicit `none_relevant` may clear the candidate
  set. Timeout, malformed or contradictory output preserves the bounded input.

Explanation:

Every selected source should be able to show simple why-shown labels:

- `Matched by content`
- `Same folder`
- `Shared tag`
- `Linked from current note`
- `Recently edited`
- `Part of selected scope`
- `Confirmed memory source`
- `Included by user-selected scope`

## 5. Retrieval Modes

| Query / task | Retrieval mode | User-facing behavior |
| --- | --- | --- |
| current note question | local evidence | run directly; show source chips after |
| selected notes | bounded scope | show lightweight scope row |
| current folder/tag review | scoped review | show included/skipped sources |
| recent 7-day review | activity scope | show included/skipped sources |
| broad vault question | plan-first broad retrieval | show sources to check before run |
| past months / long horizon | plan-first temporal retrieval | include time range and source categories |
| sensitive or ambiguous scope | ask-user | ask before reading or sending provider context |
| maintenance proposal | action-safety retrieval | affected scope, link/path impact, source evidence |
| memory candidate | admission retrieval | sourceRefs, scope, validity, conflict check |

## 6. Sources To Check

User-facing name:

> Sources to check

Avoid exposing terms such as RAG, top-k, vector score, reranker, graph expansion,
or embedding in ordinary UI.

Broad query flow:

```text
User asks broad question
-> PA proposes sources to check
-> user runs or adjusts
-> PA retrieves
-> answer includes sources and replay trace
```

Example:

```text
Sources to check

Included:
- Current note
- PA Agent folder
- Notes tagged #pa-agent, #memory
- Recent 90 days
- Confirmed product decisions

Excluded:
- private folders
- .pagelet generated notes
- #no-ai notes

Run / Adjust
```

Preview policy:

| Scope/task | Plan preview |
| --- | --- |
| current note | no preview; show sources after |
| selected notes/current folder | lightweight scope row |
| recent review | included/skipped list |
| whole vault / all related / past months | sources-to-check preview |
| costly provider call | sources-to-check preview |
| sensitive folder may be relevant | ask-user |
| memory-affecting output | show sources before confirmation |
| maintenance write proposal | show affected scope and source evidence |

## 7. Retrieval Outcome

Active Vault Indexer should return a structured retrieval outcome, not only a
list of documents.

Recommended shape:

```text
RetrievalOutcome
  status
  taskKind
  scope
  sources
  skippedSources
  missingScopeHints
  conflictingSources
  whyShown
  confidence
  recommendedNextAction
  replayMetadata
```

Statuses:

| Status | Meaning | User behavior |
| --- | --- | --- |
| `evidence_found` | enough source evidence exists | answer or generate item with citations |
| `partial_evidence` | some support, not enough for strong conclusion | answer with boundaries |
| `needs_scope` | current scope likely too narrow | ask to expand or adjust scope |
| `conflict` | retrieved sources disagree | show conflict instead of forcing one answer |
| `no_evidence` | no reliable source evidence | abstain or ask user for sources |
| `blocked_by_privacy` | relevant scope is excluded/sensitive | ask-user or abstain |

No-answer examples:

- `I found related notes, but none clearly confirm this decision.`
- `I can answer from these three notes, but the evidence is partial.`
- `This may require checking excluded or older notes. Expand scope?`
- `I found conflicting evidence. Here are the two versions.`

## 8. Surface-specific Policies

The substrate is shared; policies are surface-specific.

| Surface | Policy focus | Notes |
| --- | --- | --- |
| Chat | fast, question-directed, evidence-aware | current note + relevant notes; broad query uses plan-first; a valid miss receives one Host-owned automatic relaxed retry |
| Pagelet | scope-first review | visible included/skipped sources; one run may return 0–2 independently validated insights and may spend at most one Host-owned relaxed retry |
| Maintenance Review | action safety | affected scope, link/path impact, source evidence, undo context |
| Memory | admission safety | sourceRefs, scope, validity, conflict checks |
| Scope Recap / periodic summaries | bounded reflection | recent activity, selected scope, unresolved questions, memory conflicts |

Policy objects can be internal implementation details:

- `ChatRetrievalPolicy`
- `PageletReviewPolicy`
- `MaintenanceRetrievalPolicy`
- `MemoryAdmissionPolicy`
- `WeeklyReviewPolicy`

User-facing consistency requirements:

- same excluded folders/tags
- same sourceRefs shape
- same why-shown labels
- same no-answer statuses
- same replay trace model

## 9. Source Refs And Evidence Packets

UI source ref:

```text
UISourceRef
  path
  heading
  blockId
  excerpt
  generatedAt
  contentHash
  whyShown
  evidenceStrength
```

Persisted replay source ref:

```text
ReplaySourceRef
  path
  heading
  blockId
  generatedAt
  contentHash
  excerptHash
  whyShown
  evidenceStrength
```

Rule:

> `excerpt` is allowed in UI/context rendering, but it is not persisted in
> Replay Trace by default.

The persisted replay record should be enough to re-resolve evidence from the
vault source of truth, without storing private note text as hidden local audit
data. If a future replay feature needs retained excerpts, it requires a
separate Data Boundary/security review covering redaction, retention, export,
cleanup, and user-facing copy.

Evidence strength:

- `strong`
- `partial`
- `weak`
- `missing`
- `conflicting`

Evidence packets should be small enough for UI, but precise enough to let the
user inspect the original note. Replay packets should keep metadata and hashes,
then rehydrate excerpts from the vault only when a user-visible UI asks for
them and the source still passes Data Boundary checks.

Requirements:

- Every generated claim that matters should map to at least one SourceRef or be
  labeled unsupported.
- Summaries must drill down to source notes.
- Maintenance proposals must show the note(s) affected and source reason.
- Memory Candidates must include sourceRefs before confirmation.

## 10. Data Boundaries

Active Vault Indexer must obey the same data boundaries as Pagelet and Memory.

Hard exclusions:

- `.trash`
- hidden/system folders unless explicitly selected
- Pagelet-generated notes unless explicitly included
- folders excluded in PA settings
- tags such as `#private`, `#no-ai`, `#no-review` when configured

Under DEC-027, these remain hard seed、candidate、result、sourceRef、provider、UI
and replay exclusions. A PPR traversal may use at most one excluded Markdown
node as a local opaque bridge between allowed notes. The bridge contributes no
content or identity outside the transient traversal frame; generated notes、
attachments and consecutive excluded nodes can never bridge. This is not a
per-run override and grants no read, send or display permission.

Provider boundary:

- Manual broad retrieval should show sources-to-check before provider calls.
- Sensitive or excluded scopes require ask-user.
- Local-only signals should be used where possible before sending note text.
- Source preview should explain what may be sent to the configured AI provider.

Storage boundary:

- Index/cache state remains local by default.
- Markdown notes remain source of truth.
- Generated summaries, theme recaps, and derived graph state are not user source
  data unless explicitly saved as vault artifacts.

### 10.1 B-125 Scoped Retrieval Optimization

The following requirements are the stable product/data contract for B-125.
Current implementation ownership lives in the VSS/PA Agent architecture、source
and focused tests；the completed implementation/validation trail is historical
[B-125 closeout evidence](../../archive/2026/b-125-retrieval-optimization-closeout.md).

#### Requirements

- **B-125/REQ-01 — Strict, available-model reranking.** Zero candidates produce
  deterministic `none_relevant` without a model call. One or more candidates
  are reranked with the configured policy model, otherwise the configured Chat
  model. The selected model is called once. Timeout, provider failure,
  malformed output, invalid indices or verdict/ranking contradiction fail open;
  only valid explicit `none_relevant` can hide the complete set.
- **B-125/REQ-02 — Bounded evidence projection.** Direct candidates are capped
  at 12 unique paths and graph candidates at 6, for at most 18 unique reranker
  candidates. `MemorySearchResult.candidates` stays Host-internal. The answer
  model sees at most 8 final documents, sources derived only from those
  documents and necessary control signals；candidate/rejected-ledger paths、
  excerpts、nested documents、graph scores and bridge identities are excluded.
  A valid reranker may freely mix direct and graph. Fail-open preserves direct
  hybrid order before graph cosine order and applies no cross-origin score
  decay or forced graph reservation.
- **B-125/REQ-03 — Additive local、breadth and convergence structure recall.**
  At most three different Markdown note/path seeds run separate PPR on one
  shared boundary graph. `Local` gives every eligible one-transition note a
  query-cosine chance before truncation；`Deep Breadth` uses the equal-weight
  mean and excludes Local only from candidate selection, not propagation；
  `Convergence` uses the second-largest per-seed score and may overlap either
  lane. Each non-empty eligible lane nominates at most one path, overlap consumes
  one graph seat without replacement debt, and remaining graph capacity is
  filled by cosine up to six. Full CEPS subgraph extraction is out of scope.
- **B-125/REQ-04 — One opaque excluded bridge.** One excluded Markdown node may
  participate only as a transient local topology bridge. It never becomes a
  seed, candidate, result, source, why-shown reason or provider input, and its
  body、excerpt、title、path and metadata never enter output、diagnostics、
  telemetry or replay. Generated notes、attachments、consecutive excluded
  nodes and a second excluded node in the same restart excursion are blocked.
- **B-125/REQ-05 — Host-owned single recovery.** Chat Host Policy automatically
  spends at most one relaxed retry after valid `none_relevant`; partial evidence
  is retained and retries only when it is insufficient for the unresolved need.
  Pagelet owns a separate run-scoped token. `MemorySearchTool` carries no
  session/run retry ledger. Explicit user time constraints survive retry. A
  valid-none retry reuses the first validated query and its frozen lexical plan;
  no second keyword extraction、semantic rewrite or path/title concatenation is
  allowed. Its run-scoped rejected-evidence ledger covers only the actual
  Boundary-safe reranker input and identifies the pair `canonical path` plus
  `reranker-visible evidence fingerprint`. Relaxed candidate admission is novel
  path first、changed evidence only as backfill；exact repeats cannot re-enter
  reranker/final evidence.
  Suppressed paths remain graph transition states. Old direct seeds may be used
  only as topology-only fallback roots when the relaxed direct stage produces no
  fresh seed；they never fill otherwise empty seed slots.
- **B-125/REQ-06 — Pagelet depth without quota pressure.** A Pagelet run returns
  0–2 insights. Zero insights may use the single retry to seek the first. One
  insight may use it only when a concrete unresolved lead exists, to seek a
  second insight that is not a paraphrase and independently passes source
  grounding、currentness、novelty and value gates. Without an explicit time
  constraint Pagelet may explore across time.
- **B-125/REQ-07 — Query-aligned source chunks and dependency-aware failure.**
  Graph paths reuse the invocation's query embedding locally to select up to
  three indexed chunks per path. No re-embedding or whole-note retrieval occurs
  in this stage. PPR-only failure discards Deep Breadth/Convergence but may keep
  a completely and safely cosine-ranked Local lane；shared snapshot、Boundary、
  embedding or Worker failure discards all graph expansion. A high-degree Local
  lane is never returned as an adjacency-ordered prefix when complete scoring
  cannot fit its deterministic work budget.
- **B-125/REQ-08 — Lexical correctness before retrieval tuning.** SQLite FTS5
  remains the local lexical engine and RRF remains the default vector/lexical
  fusion. CJK indexing and querying use one deterministic normalization over a
  derived local FTS surface；the one-sided character-phrase mismatch is not an
  allowed baseline. OD-06A selects `CHAR-PHRASE`: index/query both normalize CJK
  grapheme-character units and preserve continuous-run adjacency/order. The
  target can independently rank title、heading、body and a bounded path-derived
  signal. Physical token encoding/columns、column weights、strict/OR query
  strategy、candidate depth and RRF parameters require fixtures after correctness
  is restored. No new semantic retry rewrite、SPLADE or external search engine is
  introduced by B-125. Phase 0A compared deterministic bigram plus indexed
  unigram fallback、symmetric character phrase and an explicit-locale/fingerprinted
  `Intl.Segmenter` challenger；trigram was a known-limitation control. That runner
  produced an eligible shortlist；the owner subsequently selected the profile.

#### Acceptance Criteria

- **B-125/AC-01:** Fixtures prove policy-model priority、Chat-model selection
  only when policy is absent、zero-candidate zero-call behavior、single-candidate
  reranking、valid verdict handling, and fail-open behavior for every invalid or
  failed response class. No failure performs a second model call.
- **B-125/AC-02:** The answer-model observation contains no `candidates`,
  candidate excerpt/anchor, PPR score/lane or bridge identity. Reranker input is
  at most 18 unique paths；one standard/retry recovery episode exposes one
  cumulative projection of at most 8 final documents；every visible source is
  derived from a final document, no candidate-only source exists, and Pagelet's
  visible source projection is deduplicated by canonical path. Fixtures prove a
  valid ranking may mix origins, while every fail-open class uses direct hybrid
  order followed by graph cosine order with no cross-origin decay/reservation.
- **B-125/AC-03:** Tests cover complete one-hop cosine-before-truncation；Local
  exclusion from Deep Breadth candidates but retention in PPR propagation；
  one/two/three-seed breadth and convergence；multi-seed aggregation before
  truncation；no `max` merge or absolute `0.02` relevance gate；membership-aware
  one-per-lane nominations、overlap dedupe without replacement debt、cosine
  backfill and final graph≤6. Lane workset/high-degree constants require fixture
  and current-real-iPhone practical-proxy calibration rather than being fixed by
  this AC；this is a mainstream-device risk gate, not floor-grade certification.
- **B-125/AC-04:** `allowed A → excluded Markdown B → allowed C` can surface C
  when C independently passes all gates. Two excluded nodes、generated notes
  and attachments cannot bridge; spies over provider input、result DTO、source
  refs、logs、telemetry and replay contain no B identity or content.
- **B-125/AC-05:** A Chat valid miss automatically retries exactly once;
  malformed/fail-open results and unrelated later searches remain standard.
  Partial documents survive retry, and explicit date/range filters are retained.
  Fixtures prove same-query/frozen-lexical-plan reuse、an empty ledger for a
  deterministic zero-candidate miss、direct bounded overfetch and exact-repeat
  filtering before every direct/graph candidate-selecting truncation、novel-before-
  changed admission、no exact repeat in reranker/final evidence、full propagation
  through a rejected allowed path, and topology-only old-seed fallback only when
  there is no fresh direct seed. Recovery state is
  episode-local and never appears in provider input、model observation、logs or
  replay.
- **B-125/AC-06:** Pagelet fixtures finish legally with 0、1 or 2 insights;
  cover zero-to-first and one-plus-concrete-lead-to-second recovery; prove one
  run token only and reject duplicate/rephrased second findings.
- **B-125/AC-07:** The same query embedding selects each path's top three chunks
  by `score DESC, chunkIndex ASC`. Fixtures distinguish PPR-only failure, which
  may preserve a safely completed Local lane, from shared snapshot/Boundary/
  embedding/Worker failure, which returns direct-only. Local budget overflow
  returns no biased prefix；no path uses file-head substitution、re-embedding or
  an unhandled failure.
- **B-125/AC-08:** Real sqlite-wasm MATCH fixtures cover Chinese、English、mixed
  CJK/kana、title、heading、path basename、error code and long-note cases, and
  prove the index/query normalization is identical. Retrieval-quality fixtures
  report FTS-only Recall@K、pre-reranker hybrid Recall@12、final Recall@8/MRR and
  unique-path recall before selecting AND/OR、field weights、candidate depth or
  RRF constants. B-125 current-device acceptance uses 3 core plus at most 1
  conditional targeted iPhone canary for risks that Desktop and deterministic
  fixtures cannot prove. Loaded artifact identity and the iOS normalization
  fingerprint are setup probes. Product cases are ordinary Provider completion、
  the exact Recovery readiness/approval/timeout cleanup path with one graph-enabled
  workload、cancellation/queue release, and Pagelet first-use only when same-artifact
  evidence is absent. The canaries must stay within
  existing absolute deadlines、show no app/renderer hang or OS termination、no
  unbounded local-index growth、no accepted-after-cancel result and no repeatable
  material raw latency/UI regression. Record raw timing、UI and index observations；
  B-125 makes no p95、percentage or floor-performance claim. Six frozen selected-
  reranker ranking cases、the structured explicit-temporal canary and Pagelet 0/1/2
  remain independent deterministic/Desktop current-App quality gates and are not
  repeated on iPhone. One Desktop source-triggered upsert must prove ordinary
  incremental lexical maintenance before `lexicalProfile` defaults on. Every
  evidence slice finalizes and invalidates independently；
  runner/verifier/docs-only changes、legal monotonic bookkeeping or a different
  slice's failure cannot retroactively erase a committed product observation.
  Missing evidence keeps only the implicated rollout flag off until investigated or
  explicitly accepted by the owner. Process physical footprint、the compact
  33-episode profile、p95 and extended profiler certification are B-127 scope. A
  profile upgrade rebuilds
  only local derived FTS state from allowed existing chunk records, with no
  provider call、re-embedding or Markdown mutation. Selected-profile normalization
  canaries are verified across supported desktop/mobile runtimes and a fingerprint
  change requires a versioned derived rebuild. Phase 0A freezes labels before
  registering strategies；its primary admission gate uses common strict query
  semantics, while OR is deferred to Phase 0B calibration. A candidate enters OD-06A consideration
  only when all core CJK cases reach Top-8、English/code does not regress、MATCH
  errors stay zero and equal-weight metadata fields make title/heading/path-only
  relevant notes reachable. Passing does not automatically choose a winner.

## 11. Relationship To Current Memory/VSS

Current Memory/VSS remains the lower-level local index foundation:

- OPFS SQLite/WASM stores local embedding/index data.
- IndexedDB stores local maintenance state.
- Markdown vault remains source of truth.
- Ordinary users see product language such as `Memory from your notes`.

Active Vault Indexer is the product-level retrieval substrate above that:

- combines semantic, source, structure, and activity lanes
- returns structured retrieval outcomes
- provides sourceRefs and why-shown
- supports plan-first broad retrieval
- serves Chat, Pagelet, Maintenance, and Memory

Implementation should not fork a parallel index unless a later SDD proves it is
necessary. Prefer extending VSS/Memory contracts and local metadata stores.

## 12. Metrics

Product metrics:

- grounded claim rate
- citation/source coverage
- source drill-down correctness
- context relevance@k
- no-answer calibration
- conflict detection rate
- source preview adjustment rate
- privacy-excluded note leakage rate
- stale index incident rate
- broad-query plan acceptance rate
- user correction rate for why-shown

Operational metrics:

- background update p50/p95
- query p50/p95
- provider cost per broad retrieval
- local index freshness
- cache rebuild/refresh failures
- mobile availability/degradation rate

Quality gates:

- Excluded paths never appear in retrieval outcomes unless explicitly selected.
- Broad retrieval produces a sources-to-check plan before provider calls.
- Important claims can drill down to source notes.
- No-evidence and conflict statuses do not get converted into unsupported fluent answers.
- Surface policies share sourceRefs and why-shown semantics.

## 13. Phased Roadmap

### Phase 0: Product Contract

Status: this document.

- Define Active Vault Indexer as shared infrastructure.
- Define MVP lanes.
- Define plan-first broad retrieval.
- Define RetrievalOutcome statuses.
- Define shared substrate / surface-specific policy split.

### Phase 1: Substrate Contract Standardization

This phase should not optimize for a large new user-facing entry. It should make
the shared evidence model real enough for later surfaces to adopt consistently.

- Standardize `UISourceRef` and `ReplaySourceRef` shapes.
- Standardize RetrievalOutcome shape and statuses.
- Standardize lane names and output contracts.
- Standardize excluded path/tag behavior.
- Standardize why-shown labels.
- Standardize replay metadata shape.
- Define internal surface policy interfaces for Chat, Pagelet, Maintenance,
  Memory, Scope Recap, and periodic summaries.

### Phase 2: Source + Activity + Existing Semantic

- Ensure current Memory/VSS results can drill down to note path, heading/block,
  and excerpt.
- Add activity/context source labels for current note, selected notes, recent
  notes, changed notes, and Pagelet scope.
- Preserve existing semantic retrieval while adapting it to RetrievalOutcome.
- Add lightweight no-answer / partial / conflict statuses where possible.

### Phase 3: Structure Rerank And Why-shown

- Add folder/tag/link/backlink/alias signals.
- Use structure/activity as rerank inputs.
- Render why-shown labels in Chat/Pagelet/Maintenance/Memory candidates.
- Keep structure as context, not truth.

### Phase 4: Pagelet Adoption

After the substrate contract is stable, Pagelet should be the first user-visible
surface to adopt Active Vault Indexer because Pagelet is already scope-first and
review-oriented.

- Use shared SourceRef and RetrievalOutcome in Pagelet review results.
- Show included/skipped sources through Pagelet's existing scope model.
- Add why-shown labels for Pagelet insight, review, memory candidate, and
  maintenance items.
- Connect Pagelet source cards and Review Queue items to replay metadata.

### Phase 5: Chat Adoption

Chat should adopt the substrate after Pagelet so broad, open-ended questions can
reuse proven sourceRefs, outcome statuses, exclusions, and why-shown behavior.

- Add plan-first `Sources to check` for broad/costly/sensitive Chat questions.
- Keep small current-note questions fast.
- Show used sources and retrieval outcome state after answer.
- Connect Chat answers to replay metadata and Trust Layer source-backed cards.

### Phase 6: Sources To Check For Broad Retrieval

- Add plan-first broad query flow.
- Let users adjust included/excluded scopes.
- Reuse Pagelet included/skipped scope UI where possible.
- Connect plan metadata to Replay Trace.

### Phase 7: Surface-specific Policy Completion

- Formalize remaining Maintenance, Memory, and Weekly policy objects.
- Ensure all policies share exclusion rules and SourceRef shape.
- Add policy-specific eval fixtures.

### Phase 8: Recap And Theme Lanes

- Add folder/tag/scope recap with source drill-down.
- Add theme/community summaries only after drift and source coverage are measurable.
- Keep graph visualization and entity ontology out of MVP.

## 14. Resolved B-125 Choice And Open Questions

OD-06A was owner-confirmed on 2026-08-08: ship the `CHAR-PHRASE` CJK profile
family. All three candidates passed the original Phase 0A admission gate；the
separate context-boundary evidence showed CHAR/BIGRAM retained both selected
continuous-text hard positives while INTL's lexical leg missed both, and the
25k deterministic scale evidence showed CHAR materially smaller/faster to build
than BIGRAM. INTL remained smallest and often fastest per query but traded away
the selected lexical recall cases. The evidence and its non-production/current-
macOS-only boundaries are compressed into the
[B-125 closeout evidence](../../archive/2026/b-125-retrieval-optimization-closeout.md).

B-125 EC-02 selected the standard candidate `8 vector / 12 lexical / 18 fusion`,
top-level clause OR、body-favoring BM25 weights and equal-leg `RRF k=30`；the inherited
relaxed、graph、deadline and batch envelopes passed the required deterministic、
Desktop、platform and targeted-device safety slices and were accepted for rollout.
Their source labels remain provenance for the current dormant default-off profile,
not delivery status or permanent architecture constants.

There are no remaining B-125 retrieval-behavior or runtime-architecture choices.
The owner set `minimumIPhoneModel=iPhone 15` on 2026-08-11 and confirmed
`minimumIOSVersion=17.0` plus `minimumObsidianVersion=1.11.4` on 2026-08-13.
These values remain the declared B-125 rollout hardware/software floor. Because
the exact older software environment is unavailable, the owner accepts the
recorded 2026-08-11 within-freshness-window newer-version real-iOS verifier PASS
result as this track's software-version proxy validation baseline, based on the
product assumption that mainstream users usually update promptly. This closes
the requirement to execute the exact
iOS 17.0 / Obsidian 1.11.4 tuple for B-125 as an explicit risk acceptance, not
as an exact-floor test PASS. That verifier evidence records Obsidian API `1.13.6`,
an `ios-wkwebview` runtime classification, opaque device identity, loaded/vault/
current-dist plugin and bundle hashes, plus runtime/profile canaries. The base
remains `CANDIDATE / UNATTESTED`, and the PASS was time-bounded；it does not bind
the actual iOS/WebKit version or exact device model. Compatibility at the declared
software floor therefore remains an untested residual risk.

For B-125 current-device acceptance, the owner accepts the currently available
real iPhone with newer iOS and Obsidian as a practical WKWebView proxy for
mainstream users who update promptly. This device need not claim
`representsFloor=true`, and the gate is not a minimum-hardware performance
certification. The 2026-08-30 owner amendment supersedes the earlier B-125
requirement for `1 + 5` control、`3 + 10` standard、`3 + 10` retry、one cancellation
and p95 reporting. Those 33 episodes, together with the original `23 + 23 + 1`
profile、Xcode/Instruments conversion、device-derived thresholds and process-
footprint certification, move to non-blocking
[B-127](../../backlog.md#已延期的产品与工程工作).

B-125 instead requires 3 core plus at most 1 conditional current-artifact iPhone
canary set covering only platform-specific or changed lifecycle risk. Deterministic
fixtures and one Desktop current-App pass own CJK/rerank/PPR/Data Boundary、six rankings、structured
temporal、Pagelet 0/1/2 correctness and source-triggered lexical upsert；Darwin and
Linux exact-renderer receipts own normalization parity. iPhone loaded identity and
normalization fingerprint are setup probes. The three core product cases are
ordinary Provider、graph-enabled exact Recovery readiness/approval/timeout cleanup
and cancellation/queue recovery；Pagelet first-use is the conditional fourth case.
It records absolute deadline、raw
latency/UI/index and termination observations without deriving p95 from a small
sample. A repeatable material regression keeps only the implicated flag off pending
investigation or explicit owner risk acceptance. During B-125 execution, each flag
required its own owner disposition；missing Linux/iPhone/rollout evidence kept that
flag off without blocking the default-off candidate or unrelated completed evidence.
Runner-only or documentation changes do not require plugin deployment and do not
stale an already committed product-runtime slice.

The 2026-08-30 closeout records owner-approved rollout dispositions for
`lexicalProfile`、`strictReranker`、`graphPpr` and `relaxedRecovery`. This closes the
B-125 evidence gate；it does not itself flip current source defaults or authorize a
commit、push、tag、publish or release. A later shipping-default change must preserve
explicit per-flag false rollback and the Win32 mask, version any changed calibration
identity, and run only its affected focused/default/on/off/lifecycle gates.

Because no Windows device is currently available, the owner temporarily excludes Win32
runtime support from B-125 only. The required desktop rollout matrix for this
track is therefore `darwin` + `linux`; a missing Win32 receipt is not a B-125
blocker. This scoped support waiver is not a Win32 PASS、compatibility claim or
permanent removal of Windows from PA, and it does not change the manifest or any
other PA Windows support. On Windows, the effective values of the four B-125
rollout flags `lexicalProfile`、`strictReranker`、`graphPpr` and
`relaxedRecovery` must be forced fail-closed to `false` without overwriting raw
settings, preserving the existing direct/vector fallback. Restoring B-125
Windows support requires an available Windows environment、a same-artifact
Win32 receipt plus Darwin/Linux/Win32 aggregate、Win32 App/OPFS/flag lifecycle/
fallback/cancel smoke and explicit owner approval. Xcode/Instruments and
the compact/extended performance-certification lanes are deferred to B-127 rather
than being B-125 blockers. B-125's targeted current-device safety canaries are
complete and retained in the compact closeout evidence. These rollout choices select
evidence baselines and do not change the approved retrieval behavior above.

The following are non-blocking future Active Vault Indexer questions:

- What minimum heading/block precision is realistic for current Markdown parsing?
- Should Pagelet-generated review notes be excluded by default from all retrieval or only from Pagelet review?
- How should broad retrieval behave on mobile when indexing is unavailable or stale?
- Should user corrections to why-shown labels update rerank preferences?
- Should Pagelet adoption and Chat adoption ship in separate releases or one release train after substrate standardization?

## 15. Non-goals

- No standalone Indexer page.
- No user-facing RAG/GraphRAG controls.
- No heavy whole-vault graph ontology in MVP.
- No graph visualization as core product.
- No unsupported answer when evidence is missing.
- No provider call over broad/sensitive scopes without visible scope policy.
- No new vault-written runtime index state by default.

## 16. Summary

Active Vault Indexer gives PA a shared, explainable way to see the vault.

The intended product shape is:

- internal shared substrate
- Source + Semantic + Structure + Activity lanes in MVP
- broad retrieval plan-first
- structured retrieval outcomes
- no-answer and conflict-aware behavior
- common sourceRefs and why-shown labels
- surface-specific policies on top of one substrate
- first implementation phase focused on substrate standardization, followed by
  Pagelet adoption and then Chat adoption
- future recap/theme lanes only after source drill-down and drift controls

This makes PA's evidence layer more trustworthy without turning it into a
visible knowledge-management system the user has to administer.
