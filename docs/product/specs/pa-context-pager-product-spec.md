# PA Context Pager Product Spec

Updated: 2026-07-11

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Status | Bounded M6 Context Pager implementation complete |
| Feature family | Context Pager / Context Trace / Context Packing UX |
| Primary surfaces | Chat, Pagelet Panel, Weekly Review |
| Related research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Pagelet Trust Layer spec](../../archive/pagelet-trust-layer-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |
| Related runtime docs | [PA Agent architecture](../../architecture/pa-agent-architecture-plan.md), [Runtime lifecycle](../../architecture/pa-agent-runtime-lifecycle-plan.md) |

This spec defines Context Pager as PA's user-readable context transparency
layer. The bounded M6 implementation is current; future expansion remains
subject to the same transparency boundary.

The product definition:

> Context Pager shows what PA used, what it did not use, and why, without
> exposing prompt internals to ordinary users.

This document records the one-question-at-a-time product decisions confirmed on
2026-06-28.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| CP-D1 | Context Pager is a user-visible compact context trace, not a full debug inspector. | Users can inspect context choices; prompt chunks and full replay stay in developer/debug views. |
| CP-D2 | It appears in Chat, Pagelet Panel, and Weekly Review. | Main high-trust surfaces get transparency; Bubble and Quick Capture stay lightweight. |
| CP-D3 | It shows used sources, used memories, dropped memories/context, skipped scopes, and compressed context summary. | Users see both inclusion and exclusion decisions in product language. |
| CP-D4 | It allows lightweight context correction. | Users can include/exclude sources, use/drop memories, mark stale, and adjust scope for a run. |
| CP-D5 | Corrections default to current run; users may choose remember/apply-to-scope. | Avoids hidden long-term learning while allowing explicit durable preferences. |
| CP-D6 | It shows lightweight why-dropped / why-skipped reason labels. | Reasons include stale, scope mismatch, privacy excluded, low evidence, compressed, budget limit, conflict, user excluded, and sensitive. |
| CP-D7 | Context Pager is the user summary; Replay Trace is the developer/audit record. | Both share runId, sourceRefs, memoryRefs, and retrievalOutcomeId. |
| CP-D8 | Eval Harness must validate Context Pager accuracy. | Transparent UI must match actual retrieval/memory/context decisions. |

## 1. Product Decision

Context Pager should be visible to users, but compact by default.

Selected shape:

> A small expandable trace that says: "PA used these sources and memories; PA
> skipped these items for these reasons."

It should not become:

- prompt viewer
- token budget dashboard
- chunk inspector
- reranker debugger
- full replay trace

Default collapsed examples:

```text
Used 5 sources, 2 memories. 1 stale memory skipped.
```

```text
Used current note and 4 related sources. 3 excluded notes skipped.
```

## 2. Surfaces

Context Pager appears only where context transparency matters.

| Surface | Behavior |
| --- | --- |
| Chat | Shows context used for answer/action; expandable after result |
| Pagelet Panel | Shows context used for review, recall, insight, or maintenance proposal |
| Weekly Review | Shows reviewed scope, used sources, memories, skipped scopes, and compressed context |

Not in v1:

- Pagelet Bubble, except tiny why-shown labels
- Quick Capture, because capture must remain frictionless
- ordinary Memory panel list rows, except memory-specific source/why-used detail
- every individual card, unless user opens detail

## 3. Display Content

Context Pager should use product language.

### 3.1 Used

Show:

- used sources
- used memories
- used Saved Insights, when relevant
- current note / selected scope
- retrieval outcome state

### 3.2 Not Used / Dropped

Show:

- dropped memories
- dropped candidate sources
- skipped scopes
- excluded folders/tags
- compressed older context
- no-evidence or low-evidence status

### 3.3 Do Not Show To Ordinary Users

Do not show:

- raw prompt chunks
- token budget internals
- embedding scores
- reranker scores
- hidden classifier output
- full pre-compression text
- full tool trace

Those belong in Replay Trace or developer diagnostics.

## 4. Reason Labels

Why-dropped / why-skipped should be lightweight.

Allowed reason labels:

| Label | Meaning |
| --- | --- |
| `stale` | Memory/source may be outdated |
| `scope mismatch` | Item belongs to another scope |
| `privacy excluded` | Data Boundary excluded it |
| `low evidence` | Evidence was too weak |
| `compressed` | Older context was summarized |
| `budget limit` | Context budget could not include everything |
| `conflict` | Newer evidence conflicts |
| `user excluded` | User said not to use it |
| `sensitive` | Sensitivity prevented auto-use |

Avoid:

- raw algorithmic labels
- unexplained model confidence
- token allocation
- vector/reranker scores

## 5. Lightweight Corrections

Context Pager should allow users to correct context selection without editing a
prompt.

Allowed actions:

- include this source
- exclude this source
- don't use this memory here
- use this memory this time
- mark memory stale
- adjust scope for this run
- open source
- open Memory panel

Not allowed:

- full manual prompt editing
- raw chunk reorder
- hidden system prompt modification
- direct bypass of Data Boundary

Any correction must still obey:

- Data Boundary
- Context Firewall
- source availability
- provider disclosure
- action/write confirmation rules

## 6. Persistence Of Corrections

Corrections default to current run only.

User may explicitly choose:

- `remember this preference`
- `apply to this scope`
- `do not use this memory in this scope`

Possible downstream flows:

| Correction | Possible durable flow |
| --- | --- |
| don't use memory here | Memory scope update or user correction |
| use memory this time | no durable change unless user chooses |
| mark memory stale | Memory Update / Conflict flow |
| include source | one-run scope adjustment |
| exclude source | one-run exclusion or scope preference |
| apply to scope | Memory Candidate, task_constraint, or Retrieval Habit signal depending on meaning |

Do not automatically turn corrections into long-term profile.

## 7. Relationship To Replay Trace

Context Pager and Replay Trace are related but different.

| Dimension | Context Pager | Replay Trace |
| --- | --- | --- |
| Audience | user | developer, audit, eval |
| Density | compact, expandable | complete |
| Language | product language | technical details allowed |
| Shows prompt chunks | no | maybe |
| Shows source/memory decisions | yes | yes |
| Supports user correction | yes | no, audit only |
| Used by Eval | yes, as UI truth | yes, as underlying evidence |

Shared ids:

- `runId`
- `sourceRefs`
- `memoryRefs`
- `retrievalOutcomeId`
- `contextDecisionIds`
- `replayRef`

Product rule:

> Context Pager is the receipt. Replay Trace is the ledger.

## 8. Data Model Notes

Suggested Context Pager fields:

| Field | Meaning |
| --- | --- |
| `runId` | PA run id |
| `surface` | Chat, Pagelet Panel, Weekly Review |
| `retrievalOutcomeId` | Source retrieval result |
| `usedSources` | SourceRefs included |
| `usedMemories` | MemoryRefs included |
| `usedInsights` | Saved Insight refs included |
| `droppedSources` | Sources not included and reason |
| `droppedMemories` | Memories not included and reason |
| `skippedScopes` | Scope exclusions |
| `compressedContext` | Summary of compressed older chat/context |
| `reasonLabels` | Human-readable labels |
| `corrections` | User corrections for this run |
| `replayRef` | Link to Replay Trace |

## 9. Relationship To Active Vault Indexer

Active Vault Indexer supplies:

- sourceRefs
- RetrievalOutcome
- included/skipped sources
- no-answer/partial/conflict status
- why-shown
- replay metadata

Context Pager presents this in product language.

Do not create a separate source decision system inside Context Pager.

## 10. Relationship To Trust Layer And Memory

Trust Layer supplies:

- Context Firewall decisions
- used memory refs
- dropped memory refs
- Memory Conflict state
- sensitivity and stale status
- source-backed Memory Candidate information

Context Pager should show memory use only when relevant to the run.

Memory governance still belongs to Memory panel. Context Pager can link there
or start a correction flow, but it should not become the Memory management UI.

## 11. Relationship To Data Boundary

Context Pager should expose boundary effects without leaking private content.

Allowed:

- `3 notes skipped by excluded folder`
- `1 memory not used because it is sensitive`
- `This scope was not searched`

Not allowed:

- revealing excluded note titles when that would violate privacy expectation
- showing private excerpts from skipped sources
- offering include actions that bypass explicit user authorization

## 12. Evaluation

Eval Harness must validate Context Pager accuracy.

Suggested cases:

| Case | Expected behavior |
| --- | --- |
| Used source included | Context Pager lists it as used |
| Dropped stale memory | Context Pager lists stale reason |
| Privacy exclusion | Skipped scope appears without leaking content |
| Compressed older chat | Compressed context summary appears |
| Budget drop | Budget-limit reason appears |
| User correction current run | Correction affects only current run |
| Remember correction | Routes to appropriate candidate/preference flow |
| Replay alignment | Context Pager ids match Replay Trace ids |

Deterministic checks:

- used/dropped/skipped labels match underlying decisions
- no hidden used memory missing from pager
- no listed source absent from retrieval outcome
- no skipped private content leaked
- correction does not bypass Data Boundary

## 13. Roadmap

### Phase 0: Product Contract

- Link this spec from Product IA, Active Vault Indexer, Trust Layer, Data
  Boundary, Eval Harness, and coverage audit.
- Define shared context decision ids.

### Phase 1: Read-only Compact Pager

- Add collapsed summary in Chat and Pagelet Panel.
- Show used sources and used memories.
- Link to source cards and Memory panel.

### Phase 2: Dropped / Skipped Reasons

- Add dropped memories.
- Add skipped scopes.
- Add compressed context summary.
- Add reason labels.

### Phase 3: Lightweight Corrections

- Add include/exclude source for current run.
- Add use/drop memory for current run.
- Add mark stale.
- Add apply-to-scope / remember routing.

### Phase 4: Weekly Review Integration

- Show review scope, included/skipped sources, used memories, and compressed
  older context.

### Phase 5: Eval Alignment

- Add deterministic fixture checks.
- Assert Context Pager matches Replay Trace and retrieval/memory decisions.

## 14. Open Questions

- What should the user-facing label be: `Context`, `Used context`,
  `Sources & memory`, or Pagelet-native wording?
- Should the collapsed summary appear before answer, after answer, or both?
- How should corrections trigger a rerun without feeling slow?
- Which skipped private scope labels are safe enough to show?
- Should compressed context summary include chat history, note history, or both?
- Should developer/debug mode expose raw prompt context from the same pager?

## 15. Summary

Context Pager makes PA's context choices visible without making users inspect
prompts.

The durable contract:

- compact user-visible trace
- Chat, Pagelet Panel, Weekly Review
- used sources and memories
- dropped/skipped/compressed context
- lightweight reason labels
- lightweight corrections
- corrections are current-run by default
- Replay Trace remains the full developer/audit record
- Eval validates the pager against actual decisions

This is the trust receipt for PA's reasoning context.
