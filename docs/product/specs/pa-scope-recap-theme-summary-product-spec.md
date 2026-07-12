# PA Scope Recap And Theme Summary Product Spec

Updated: 2026-07-11

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Status | Source-backed M12 Scope Recap and prepared Recap delivery implemented |
| Feature family | Scope Recap / Theme Summary / Derived map |
| Primary surfaces | Pagelet Panel, Pagelet Tab, Weekly Review, Chat source-backed answers |
| Related research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Weekly Review spec](../../archive/pa-weekly-review-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [Pagelet Trust Layer spec](../../archive/pagelet-trust-layer-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |

This spec defines how PA summarizes a user-selected scope without assuming that
the vault has a formal Project model. The source-backed M12 flow and prepared
Recap delivery are implemented; recap remains derived, not source truth.

The product definition:

> Recap is a derived map, not the ground.

Recap and Theme Summary can help users review a scope, discover themes, notice
tensions, and prepare next review actions. They must not replace source notes,
act as facts by themselves, or silently become Markdown.

This document records the one-question-at-a-time product decisions confirmed on
2026-06-28.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| REC-D1 | Recap scope is user-selected, not Project-assumed. | Supported scopes include current note, selected notes, folder, tag, time range, query/search result, and future saved scope. |
| REC-D2 | Generation is on-demand plus background preparation for Weekly Review / saved scopes. | PA avoids continuous whole-vault summarization and prepares summaries only for high-intent scopes. |
| REC-D3 | Recap is stored as a local derived object; user confirmation is required for Markdown. | Summaries are reusable without polluting the vault. |
| REC-D4 | Important claims/themes require sourceRefs, and the whole recap shows source coverage. | Recap remains readable while keeping core claims verifiable. |
| REC-D5 | Output includes summary, themes, tensions, open questions, and next review actions. | Recap is review-oriented, not just a generic summary. |
| REC-D6 | Recap weakly influences retrieval/ranking. | It can act as theme/scope signal but cannot replace source evidence. |
| REC-D7 | Recap uses source-aware stale policy. | Source changes, coverage decline, boundary changes, TTL expiry, or user distrust mark recap stale. |
| REC-D8 | Recap shows lightweight uncertainty. | Coverage, skipped sources, stale badge, low-evidence label, and generatedAt are visible without debug jargon. |
| REC-D9 | User-confirmed recap can be written to Markdown with sourceRefs and generatedAt. | Markdown is a deliberate artifact, not automatic summary drift. |

## 1. Product Decision

Scope Recap should not require a Project concept.

Selected shape:

> PA summarizes the scope the user is actually working with, not the scope PA
> wishes the vault had.

Supported scope types:

- current note
- selected notes
- folder
- tag
- time range
- search/query result
- future saved scope

This respects Obsidian reality: some users organize by folders, some by tags,
some by links, some by Daily Notes, some by search, and many by inconsistent
mixtures of all of them.

## 2. Why This Matters

RAPTOR, GraphRAG, and theme-summary techniques are useful, but dangerous if
treated as source-of-truth memory.

Risks:

- summary drift
- stale conclusions
- second-hand facts replacing source evidence
- whole-vault background cost
- accidental privacy leakage
- false sense that PA understands a "project" the user never defined

Therefore Scope Recap should be:

- scoped
- source-backed
- stale-aware
- user-invoked or high-intent prepared
- weak influence only
- review-oriented

## 3. Generation Policy

Recap generation should combine on-demand generation with limited background
preparation.

### 3.1 On-demand

On-demand generation is allowed when the user asks for:

- summarize this note
- recap these selected notes
- summarize this folder
- recap this tag
- what happened in the last 7 days
- summarize these search results
- prepare a review for this scope

### 3.2 Prepared Scopes

Background preparation is allowed for:

- Weekly Review
- user-saved scopes
- user-triggered Pagelet review scopes
- manually requested refresh

Do not continuously summarize:

- the entire vault
- every folder
- every tag
- every note save
- every graph community

Prepared recap should remain quiet. It may surface through Pagelet/Weekly
Review, but should not create notifications or write Markdown by itself.

## 4. Storage Policy

Recap should be stored as a local derived object by default.

Required fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable recap id |
| `scope` | Scope definition |
| `summary` | Short scope summary |
| `themes` | Recurring source-backed themes |
| `tensions` | Source-backed conflicts, counterexamples, or tradeoffs |
| `openQuestions` | Questions worth review |
| `nextReviewActions` | Suggested review actions |
| `sourceRefs` | Sources used by important claims/themes |
| `sourceCoverage` | Coverage counts and ratio |
| `skippedSources` | Excluded, unreadable, or out-of-policy sources |
| `generatedAt` | Generation time |
| `ttl` | Expiry period |
| `staleStatus` | fresh, stale, low-coverage, boundary-changed |
| `providerInfo` | Provider/model info when applicable |
| `dataBoundarySnapshot` | Data policy at generation time |
| `replayRef` | Optional replay trace |

Recap is not:

- Raw note
- Confirmed Memory
- Saved Insight by default
- source note patch
- automatic Markdown note

## 5. Evidence Requirements

Every important claim or theme must have sourceRefs.

Important means:

- theme
- trend
- tension
- change over time
- claim about user activity
- suggestion
- next review action
- Memory Candidate seed
- Maintenance Proposal seed

The whole recap must also show source coverage.

Example coverage labels:

- `Based on 12 of 18 notes`
- `3 notes skipped by Data Boundary`
- `Low evidence: only 2 source notes`
- `Stale: 5 source notes changed since generated`

Do not rely on an end-of-document source list only. Claim-level sourceRefs are
needed for important outputs.

## 6. Output Shape

Recap should be review-oriented.

v1 output sections:

| Section | Purpose |
| --- | --- |
| Summary | What this scope is mainly about |
| Themes | Recurring ideas or patterns |
| Tensions | Conflicts, counterexamples, unresolved tradeoffs |
| Open Questions | Questions worth further thinking |
| Next Review Actions | Suggested next actions such as save insight, confirm memory, inspect source, or review maintenance |

Recap should not default to an action plan. It may suggest next review actions,
but those actions still require user confirmation and the relevant workflow.

## 7. Influence On Retrieval

Recap has weak retrieval influence.

Allowed:

- theme signal
- scope signal
- recall candidate source
- rerank hint
- Weekly Review grouping hint
- Saved Insight candidate seed

Not allowed:

- answering factual questions from recap alone
- replacing source note evidence
- overriding Confirmed Memory
- creating Memory from recap without source-backed candidate review
- acting as a durable graph/community fact

Product rule:

> Recap can help PA find the ground, but it is not the ground.

## 8. Stale Policy

Recap uses source-aware stale detection.

Mark stale when:

- source notes changed significantly
- source notes were added or removed from scope
- key source note changed
- source coverage drops below threshold
- excluded scope or Data Boundary policy changes
- TTL expires
- user marks recap unreliable

Stale recap behavior:

- show stale badge
- avoid using as strong ranking signal
- offer refresh
- keep old recap inspectable if useful
- do not write stale recap to Markdown without refresh or explicit user choice

## 9. Uncertainty Display

User-visible uncertainty should be lightweight.

Show:

- source coverage
- skipped sources
- stale badge
- low-evidence label
- generatedAt
- provider/model disclosure where relevant

Do not show ordinary users:

- chunk scores
- embedding distances
- reranker internals
- token counts
- prompt/debug trace
- raw graph expansion metrics

Detailed replay/debug data can exist behind developer or diagnostic views.

## 10. Markdown Write Policy

Recap can be written to Markdown only after user confirmation.

Allowed Markdown targets:

- Weekly Review note
- review note
- independent Recap note
- project/reference note chosen by user

Markdown output must include:

- generatedAt
- scope
- sourceRefs for important claims/themes
- coverage summary
- stale status if not fresh

Markdown output should not include:

- skipped private source details beyond safe labels
- internal scores
- unconfirmed Memory Candidates as facts
- unconfirmed Maintenance Proposals as applied actions

## 11. Relationship To Active Vault Indexer

Scope Recap is a later Active Vault Indexer lane.

Active Vault Indexer provides:

- scope resolution
- SourceRef
- RetrievalOutcome
- source coverage
- included/skipped source policy
- why-shown labels
- replay metadata
- structure/activity signals

Scope Recap adds:

- derived summary
- themes
- tensions
- open questions
- review actions
- stale-aware derived object

This should remain downstream of the evidence substrate. Do not implement recap
as a separate retrieval stack.

## 12. Relationship To Weekly Review

Weekly Review is a primary high-intent context for recap.

Weekly Review can use recap to:

- group items by theme
- identify tensions
- suggest open questions
- propose Saved Insights
- seed Memory Candidates
- seed Maintenance Proposals

Weekly Review note may include user-accepted recap material, but not the raw
unreviewed recap object by default.

## 13. Relationship To Saved Insight

Recap can produce Saved Insight candidates.

Examples:

- theme -> Saved Insight of type `theme`
- tension -> Saved Insight of type `tension`
- open question -> Saved Insight of type `question`
- next review action -> possible Maintenance Proposal or Memory Candidate

Recap itself is not a Saved Insight. A user must save or accept a specific
derived idea before it becomes one.

## 14. Relationship To Graph Discovery

Graph Discovery can help recap find theme chains and tensions.

However:

- graph edges remain evidence aids
- AI-inferred edges require lifecycle state
- recap must still show sourceRefs
- full graph/community summaries are not MVP
- graph-derived themes should be low-confidence unless source-backed

## 15. Data Boundary And Privacy

Scope Recap must obey Data Boundary.

Required:

- broad/sensitive/costly scope uses plan-first source preview
- excluded folders/tags are skipped
- generated notes follow generated-note policy
- skipped sources appear as safe counts/labels
- provider disclosure if note content leaves local device
- local derived recap data is clearable
- Markdown write requires explicit user action

If a recap would include sensitive scopes, PA should show included/skipped scope
before generation.

## 16. Evaluation

Eval Harness should cover Scope Recap.

Suggested cases:

| Case | Expected behavior |
| --- | --- |
| Selected notes recap | Uses selected scope only and shows source coverage |
| Folder recap | Important themes have sourceRefs |
| Tag recap | No Project assumption appears |
| Time-range recap | Uses time range and shows skipped sources |
| Source changed | Recap becomes stale |
| Excluded folder | Excluded sources are not used |
| Low evidence | Low-evidence label appears |
| Markdown write | Requires user confirmation and includes generatedAt/sourceRefs |
| Retrieval influence | Recap weakly reranks but does not answer as fact |

Deterministic checks:

- every important theme has sourceRefs
- source coverage exists
- stale status changes when sources change
- recap cannot create Confirmed Memory directly
- recap cannot write Markdown without user action

## 17. Roadmap

### Phase 0: Product Contract

- Link this spec from Active Vault Indexer, Weekly Review, Saved Insight, Graph
  Discovery, Data Boundary, and Eval Harness.
- Keep recap as derived object, not source truth.

### Phase 1: On-demand Selected-scope Recap

- Support selected notes and current note group.
- Return summary, themes, tensions, open questions, next review actions.
- Include sourceRefs and coverage.
- Store local derived object.

### Phase 2: Folder / Tag / Time-range Recap

- Add folder scope.
- Add tag scope.
- Add recent 7 / 14 day scopes.
- Add skipped source labels and stale detection.

### Phase 3: Weekly Review Integration

- Use recap to group Weekly Review items.
- Create Saved Insight candidates from accepted themes/tensions/questions.
- Avoid raw recap dumping into Weekly Review note.

### Phase 4: Saved Scope Preparation

- Let users save scopes.
- Prepare recap for saved scopes at low frequency.
- Add TTL and source-aware refresh.

### Phase 5: Markdown Export

- Allow user-confirmed recap notes.
- Include sourceRefs, generatedAt, coverage, and stale status.
- Support review note / Weekly Review note / independent recap note targets.

## 18. Open Questions

- What should the UI label be: `Recap`, `Scope summary`, `Review map`, or
  Pagelet-native wording?
- What is the first supported non-current-note scope: selected notes, folder,
  tag, or time range?
- What coverage threshold should show `low evidence`?
- What TTL should be the default for Weekly Review recap versus saved scope
  recap?
- Where should independent Recap notes be saved by default?
- Should user-written Markdown recap notes be excluded from future recap by
  generated-note policy?

## 19. Summary

Scope Recap turns hierarchical and graph-style summarization into a trustworthy
product capability.

The durable contract:

- user-selected scope, not Project assumption
- on-demand plus high-intent background preparation
- local derived object by default
- sourceRefs for important claims/themes
- source coverage and uncertainty shown
- review-oriented output
- weak retrieval influence only
- source-aware stale policy
- Markdown only after confirmation

This lets PA summarize without pretending the summary is the user's vault.
