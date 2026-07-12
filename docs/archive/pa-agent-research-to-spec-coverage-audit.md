# PA Agent Research-To-Spec Coverage Audit

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-06-28

## Status

| Field | Value |
| --- | --- |
| Document type | Coverage audit / planning input |
| Status | Draft audit after product-spec extraction |
| Source report | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Primary specs audited | [Product IA](../product/pa-product-information-architecture-spec.md), [Quick Capture](../product/specs/pa-quick-capture-micronote-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md), [Maintenance Review](./pagelet-maintenance-review-product-spec.md), [Lightweight Graph Discovery](../product/specs/pa-lightweight-graph-discovery-product-spec.md), [Data Boundary](../product/specs/pa-data-boundary-product-spec.md), [Eval Harness](../product/specs/pa-eval-harness-product-spec.md) |

This audit maps the research report's product conclusions into the product
specs created from the follow-up discussion. It is not an implementation plan.

The goal is to answer:

- What research conclusions are already covered by specs?
- What is only partially covered or scattered across specs?
- What still needs a decision before SDD work?
- What should remain explicitly out of scope for now?

## 1. Executive Coverage Summary

Coverage is now strong for the main P0 research tracks:

- Active Vault Indexer / evidence-first retrieval is covered.
- Knowledge Maintenance Proposals are covered.
- Trust Layer, Evidence Cards, Memory Candidates, Context Firewall, and Memory
  Conflict Cards are covered.
- Quick Capture / micronote flow is covered.
- Quiet Recall / Insight Timing is covered.
- Lightweight Graph-aware Discovery is covered as a restrained P1 layer.
- Data Boundary and Eval Harness are covered as cross-cutting foundations.
- Product Information Architecture is covered, so Chat, Pagelet, Bubble, Memory
  panel, and Review Queue have clearer roles.

The remaining gaps are not about missing "more AI." They are about product
cohesion:

- Recap/theme lanes are intentionally deferred in Active Vault Indexer, but
  need a product policy before implementation.

## 2. Coverage Matrix

| Research conclusion | Coverage status | Current spec coverage | Gap / next action |
| --- | --- | --- | --- |
| Capture before intelligence | Covered | [Quick Capture](../product/specs/pa-quick-capture-micronote-product-spec.md) | No immediate gap. |
| Original notes are sacred | Covered | [Quick Capture](../product/specs/pa-quick-capture-micronote-product-spec.md), [Maintenance Review](./pagelet-maintenance-review-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md) | Keep source-note mutation behind preview / diff / undo in SDDs. |
| Evidence before eloquence | Covered | [Trust Layer](./pagelet-trust-layer-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md) | No immediate gap. |
| Memory is layered: Raw / Index / Derived / Confirmed | Covered | [Trust Layer](./pagelet-trust-layer-product-spec.md), [Product IA](../product/pa-product-information-architecture-spec.md), [Data Boundary](../product/specs/pa-data-boundary-product-spec.md) | Memory type taxonomy may still need a separate decision pass. |
| Confirmed Memory requires admission and lifecycle | Covered | [Trust Layer](./pagelet-trust-layer-product-spec.md) | No immediate gap. |
| Context Firewall: auto-include / ask-user / drop | Covered | [Trust Layer](./pagelet-trust-layer-product-spec.md) | Needs implementation fixtures in Eval Harness later. |
| Retrieval is a router, not top-k | Covered | [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md) | Recap/theme lanes deferred; see separate row. |
| No-answer / partial / conflict retrieval outcomes | Covered | [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Eval Harness](../product/specs/pa-eval-harness-product-spec.md) | No immediate gap. |
| Broad retrieval should be plan-first | Covered | [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Data Boundary](../product/specs/pa-data-boundary-product-spec.md) | Needs future SDD detail. |
| Graph should be background index first | Covered | [Lightweight Graph Discovery](../product/specs/pa-lightweight-graph-discovery-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md) | No full graph product for now. |
| Use user structure before AI ontology | Covered | [Lightweight Graph Discovery](../product/specs/pa-lightweight-graph-discovery-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md) | No immediate gap. |
| Quiet UX beats autonomous theater | Covered | [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md), [Product IA](../product/pa-product-information-architecture-spec.md), [Pagelet product design](../product/pagelet-product-design.md) | No immediate gap. |
| Action must be preview-first | Covered | [Maintenance Review](./pagelet-maintenance-review-product-spec.md) | Runtime write-boundary expansion still required before implementation. |
| Maintenance is a core PA job | Covered | [Maintenance Review](./pagelet-maintenance-review-product-spec.md) | No immediate product gap. |
| Local-first means explicit data boundaries | Covered | [Data Boundary](../product/specs/pa-data-boundary-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Quick Capture](../product/specs/pa-quick-capture-micronote-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md) | No immediate gap. |
| Evaluation is a product feature | Covered | [Eval Harness](../product/specs/pa-eval-harness-product-spec.md) | Future SDD should define first fixture files and CLI. |
| Chat is not the center | Covered | [Product IA](../product/pa-product-information-architecture-spec.md) | No immediate gap. |
| Pagelet is primary review surface | Covered | [Product IA](../product/pa-product-information-architecture-spec.md), [Maintenance Review](./pagelet-maintenance-review-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md) | No immediate gap. |
| Review Queue is shared and typed | Covered | [Product IA](../product/pa-product-information-architecture-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md), [Maintenance Review](./pagelet-maintenance-review-product-spec.md), [Quick Capture](../product/specs/pa-quick-capture-micronote-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md) | Future SDD should avoid creating separate per-feature queues. |
| Low-frequency recall with evidence | Covered | [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md) | No immediate gap. |
| Insight must have evidence, delta, and next action | Covered | [Saved Insight and Insight Ledger](../product/specs/pa-saved-insight-ledger-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md) | No immediate gap. |
| Weekly Review / Pagelet Review compounds value | Covered | [Weekly Review](./pa-weekly-review-product-spec.md), [Maintenance Review](./pagelet-maintenance-review-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md), [Eval Harness](../product/specs/pa-eval-harness-product-spec.md), [Pagelet product design](../product/pagelet-product-design.md) | No immediate gap. |
| Folder/project recap and hierarchical summaries | Covered | [Scope Recap and Theme Summary](../product/specs/pa-scope-recap-theme-summary-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md) Phase 8 | No immediate gap. |
| Theme/community summaries | Covered | [Scope Recap and Theme Summary](../product/specs/pa-scope-recap-theme-summary-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Quiet Recall](../product/specs/pa-quiet-recall-insight-timing-product-spec.md), [Lightweight Graph Discovery](../product/specs/pa-lightweight-graph-discovery-product-spec.md) | No immediate gap. |
| Retrieval Habit Profile | Covered | [Retrieval Habit Profile](../product/specs/pa-retrieval-habit-profile-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), [Data Boundary](../product/specs/pa-data-boundary-product-spec.md) | No immediate gap. |
| Context Pager / context packing UX | Covered | [Context Pager](../product/specs/pa-context-pager-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md), [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md), existing context runtime docs | No immediate gap. |
| Memory profile / user model boundary | Covered | [Memory Type Taxonomy](../product/specs/pa-memory-type-taxonomy-product-spec.md), [Trust Layer](./pagelet-trust-layer-product-spec.md), [Data Boundary](../product/specs/pa-data-boundary-product-spec.md) | No immediate gap. |
| Mobile / voice capture | Deferred but acknowledged | [Quick Capture](../product/specs/pa-quick-capture-micronote-product-spec.md) | No v1 work; revisit after desktop capture is validated. |
| External Action Preview | Intentionally deferred | [Maintenance Review](./pagelet-maintenance-review-product-spec.md), existing Operations docs | User confirmed external action is out of current scope; do not spec now. |
| Full Personal Knowledge Graph | Intentionally not covered | [Lightweight Graph Discovery](../product/specs/pa-lightweight-graph-discovery-product-spec.md) rejects it for MVP | Keep out of near-term roadmap. |
| Unsupervised memory evolution | Intentionally not covered | [Trust Layer](./pagelet-trust-layer-product-spec.md) requires confirmation | Keep rejected unless user explicitly changes trust boundary. |
| Whole-vault long-context prompting | Intentionally not covered | [Active Vault Indexer](../product/specs/pa-active-vault-indexer-product-spec.md) favors retrieval/router | Keep out of product strategy. |
| Personality companion / digital twin | Intentionally not covered | None | Keep out of scope; product should be warm but evidence-centered. |
| All personal data integration on day one | Intentionally not covered | [Data Boundary](../product/specs/pa-data-boundary-product-spec.md) limits scope | Defer connectors until vault core is trustworthy. |
| Multi-agent orchestration as product surface | Intentionally not covered | None | Keep internal if needed; do not expose as product. |

## 3. Open Items Requiring Discussion

These are the remaining research-derived topics that are either partial or not
yet specified.

### 3.1 Weekly Review / Pagelet Review Mode

Status: covered by [PA Weekly Review Product Spec](./pa-weekly-review-product-spec.md).

Why it matters:

- The report marks Weekly Review / Pagelet Review as P0.
- It is the product loop where capture, recall, memory confirmation, and
  maintenance compound.
- Current specs mention weekly scan in several places, but there is no single
  contract for what the weekly review experience is.

Resolved decisions:

- Weekly Review is a Pagelet Tab mode plus optional Weekly Review note.
- v1 includes review, memory, and maintenance sections with restrained display.
- Default range is recent 7 days with natural week / recent 14 days / custom
  options.
- Trigger is manual-first with optional weekly prepared review as a quiet
  Pagelet hint.
- Weekly Review note contains only selected/saved items with sourceRefs.
- Low-risk Memory Candidates and Maintenance Proposals can be batched; high-risk
  items require individual review.

Remaining implementation details live as open questions in the Weekly Review
spec.

### 3.2 Saved Insight / Insight Ledger Artifact Policy

Status: covered by [PA Saved Insight And Insight Ledger Product Spec](../product/specs/pa-saved-insight-ledger-product-spec.md).

Why it matters:

- Quiet Recall says users can save a recall as an insight.
- Trust Layer defines source-backed cards.
- The research report warns that insights should not become chat debris.

Resolved decisions:

- Saved Insight starts as a local source-backed object and can later be written
  to Markdown.
- Saved Insight is a user knowledge asset; Memory Candidate may become a PA
  behavior constraint after confirmation.
- Insight Ledger is a Pagelet Tab filter/view, not a new top-level product.
- PA-generated insights require sourceRefs; user-authored insights can be
  unsourced but must be marked.
- Saved Insight weakly influences recall/ranking only.

Remaining implementation details live as open questions in the Saved Insight
spec.

### 3.3 Scope Recap / Theme Summary Policy

Status: covered by [PA Scope Recap And Theme Summary Product Spec](../product/specs/pa-scope-recap-theme-summary-product-spec.md).

Why it matters:

- RAPTOR and GraphRAG-style summaries are useful for folder/project/vault-level
  questions.
- The user already noted that an Obsidian vault may not have a formal Project
  concept.
- Active Vault Indexer defers recap/theme lanes to Phase 8.

Resolved decisions:

- Recap scope is user-selected: current note, selected notes, folder, tag, time
  range, query/search result, or future saved scope.
- Generation is on-demand plus background preparation for Weekly Review and
  saved scopes.
- Recap is a local derived object by default; Markdown requires user
  confirmation.
- Important claims/themes need sourceRefs and whole recap shows source coverage.
- Recap weakly influences retrieval and uses source-aware stale policy.

Remaining implementation details live as open questions in the Scope Recap spec.

### 3.4 Memory Type Taxonomy And Profile Boundary

Status: covered by [PA Memory Type Taxonomy And Profile Boundary Product Spec](../product/specs/pa-memory-type-taxonomy-product-spec.md).

Why it matters:

- Trust Layer defines Confirmed Memory fields and high-sensitivity boundaries.
- The research report proposes types such as Preference, Decision,
  Relationship, Task Constraint, and Open Question.
- LoCoMo-Plus-style user goals/values are high-risk if inferred silently.

Resolved decisions:

- v1 types are `preference`, `decision`, `project_context`,
  `task_constraint`, and `open_question`.
- Very limited profile-like memory is allowed only when explicitly expressed,
  low-sensitive, editable, deletable, and scope-limitable.
- Behavior-only profile inference is not allowed.
- Memory defaults to source scope and can be promoted to global by the user.
- Memory uses lightweight temporal validity and sensitivity.
- Memory supports forget, archive, and export.

Remaining implementation details live as open questions in the Memory Type
Taxonomy spec.

### 3.5 Retrieval Habit Profile

Status: covered by [PA Retrieval Habit Profile Product Spec](../product/specs/pa-retrieval-habit-profile-product-spec.md).

Why it matters:

- The research report suggests PA can observe whether a user relies on folders,
  tags, backlinks, search, Daily Notes, or full-text retrieval.
- This could improve defaults without forcing an ontology.

Resolved decisions:

- It is a local, clearable, weak-influence background model.
- It collects explicit behavior plus low-sensitive usage patterns.
- It weakly affects default scope, candidate ordering, recall type ratio, and
  source presentation order.
- It is lightly visible in Data & Privacy / Advanced with clear/disable.
- It does not sync, export, or write to vault.
- It uses rolling window plus decay and has deterministic eval boundary tests.

Remaining implementation details live as open questions in the Retrieval Habit
Profile spec.

### 3.6 Context Pager / Context Packing UX

Status: covered by [PA Context Pager Product Spec](../product/specs/pa-context-pager-product-spec.md).

Why it matters:

- The report distinguishes long context from long-term memory.
- Trust Layer and Active Vault Indexer expose used sources and memories, but
  the product contract for "what context did PA use" is not fully explicit.

Resolved decisions:

- Context Pager is a compact user-visible context trace, not a full debug
  inspector.
- It appears in Chat, Pagelet Panel, and Weekly Review.
- It shows used sources, used memories, dropped memories/context, skipped
  scopes, and compressed context summary.
- It allows lightweight context correction for the current run by default.
- Replay Trace remains the developer/audit record; both share ids.
- Eval Harness validates that Context Pager reflects actual context decisions.

Remaining implementation details live as open questions in the Context Pager
spec.

## 4. Explicitly Deferred Or Rejected Directions

These should not generate specs unless the product strategy changes.

| Direction | Current decision |
| --- | --- |
| Full Personal Knowledge Graph | Rejected for MVP; keep lightweight, local, source-backed graph discovery. |
| Heavy user-facing GraphRAG UI | Rejected for MVP; use graph signals in background and bounded local views. |
| Unsupervised memory evolution | Rejected; memory evolution must be user-confirmed or at least reviewable. |
| Silent automatic vault cleanup | Rejected; maintenance actions use proposal, preview, apply, undo/log. |
| External actions | Deferred by user decision; current scope is vault notes, not outside-world action. |
| Personality companion / digital twin | Rejected as product center; PA can be warm but evidence-centered. |
| All personal data integrations on day one | Deferred; vault core must become trustworthy first. |
| Multi-agent orchestration as product surface | Rejected as product surface; keep internal if useful. |
| Complex AI workflow configuration | Rejected for ordinary users; prefer simple policies and settings. |
| Insight spam | Rejected; insights need evidence, delta, and next action. |

## 5. Suggested Discussion Order

All research-derived product topics identified in this audit now have a
corresponding product spec.

Remaining work should move from product decision discussion to:

- prioritizing implementation SDDs
- sequencing release milestones
- choosing the first buildable vertical slice
- creating eval fixtures for the highest-risk contracts

## 6. Summary

The research report has mostly been converted into actionable product specs.

The main remaining work is not to add more autonomous AI features. It is to
clarify the review loop that makes the system compound:

- what gets reviewed weekly
- what becomes a saved insight
- what becomes memory
- what becomes maintenance
- what becomes only a temporary recall cue

That loop is the bridge between "PA can find things" and "PA helps the user's
knowledge system evolve without losing trust."
