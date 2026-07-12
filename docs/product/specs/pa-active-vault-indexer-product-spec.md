# PA Active Vault Indexer Product Spec

Updated: 2026-07-11

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Status | Bounded v1 and AVI deepening slices implemented; future extensions remain gated |
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
explicit future scope still requires a new SDD.

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
- Excluded folders/tags are hard filters, not rank penalties.

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
| Chat | fast, question-directed, evidence-aware | current note + relevant notes; broad query uses plan-first |
| Pagelet | scope-first review | visible included/skipped sources; supports insight/review queues |
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

## 14. Open Questions

- Should BM25 be added as a first-class lane or treated as part of semantic/hybrid retrieval?
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
