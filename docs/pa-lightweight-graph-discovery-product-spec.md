# PA Lightweight Graph-aware Discovery Product Spec

Updated: 2026-06-28

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / future implementation input |
| Status | Confirmed decision spec; implementation not started |
| Primary surfaces | Pagelet Review Queue, current note neighborhood |
| Feature family | Lightweight Graph-aware Discovery |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related substrate | [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md) |
| Related specs | [PA Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [Pagelet Trust Layer spec](./pagelet-trust-layer-product-spec.md), [Pagelet Maintenance Review spec](./pagelet-maintenance-review-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md) |

This spec defines the lightweight graph-aware product layer on top of Active
Vault Indexer. It is not current shipped behavior.

Lightweight Graph-aware Discovery helps PA surface meaningful relationships
between notes without becoming a full knowledge graph product.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| LGD-D1 | Use a restrained local Graph UI, not a full graph product. | No full-vault Knowledge Map; local graph appears only as an explanation layer for a card, note neighborhood, or scope. |
| LGD-D2 | MVP review item types are `related_note`, `theme_chain`, `conflict_pair`, and `index_note_candidate`. | Graph value appears as typed Pagelet Review Queue items, not a generic graph browser. |
| LGD-D3 | AI-inferred edges use lifecycle-based influence. | Suggested edges weakly influence discovery; accepted/source-backed edges can influence rerank more strongly. |
| LGD-D4 | Primary surface is Pagelet Review Queue; current note gets only a lightweight entry. | Discovery is review-first, with optional note-neighborhood expansion when useful. |
| LGD-D5 | Local Graph UI is bounded. | Default folded, max 8-12 nodes, max 1 hop, card/scope-local, no full-vault roaming. |
| LGD-D6 | Discovery signals include explicit structure, semantic similarity, and activity/context. | Use folder/tag/link/backlink/alias + semantic similarity + current/recent/review/memory context. |
| LGD-D7 | `conflict_pair` generation is moderately strict. | Generate conflicts for decision/status/preference/task-constraint/scope-state differences, not for ordinary opinion variation. |
| LGD-D8 | Discovery needs its own spec. | This document defines the user-visible discovery layer separately from the retrieval substrate. |

## 1. Product Decision

Graph-aware Discovery should not become a full knowledge graph product.

The user should not be asked to maintain an ontology, browse a whole-vault graph,
or understand AI-generated entities and relations. Graph signals should help PA
surface useful review items:

- related notes
- theme chains
- conflict pairs
- index note candidates

Core decision:

> Graph is a reasoning layer and a local explanation layer, not the main product
> surface.

## 2. Product Principles

### 2.1 Review Items Before Graph Views

The primary output is a typed review item, not a visual graph.

Graph UI exists only when it helps explain why a relationship was suggested.

### 2.2 User Structure First, AI Edges Second

Folder, tag, link, backlink, and alias are first-class signals because they are
user-authored or user-shaped. AI-inferred relationships are useful but must not
be treated as user intent until accepted or source-backed.

### 2.3 Soft Associations Need Lifecycle

An AI-suggested relation should not immediately pollute future retrieval.

Rule:

> Suggested edge first; stronger rerank influence only after acceptance,
> source-backing, or repeated positive feedback.

### 2.4 Local Graph UI Must Stay Local

A local graph can explain a relationship, but it must not become the user's new
navigation system.

Rule:

> Max one hop, max 8-12 nodes, no full-vault roaming.

### 2.5 Conflict Discovery Should Be Useful, Not Noisy

Not every difference is a conflict. PA should focus on differences that affect
future behavior, decisions, memory, or maintenance.

## 3. Review Item Types

| Type | Meaning | Primary actions |
| --- | --- | --- |
| `related_note` | A source-backed relationship between the current scope and another note | open, link, save, dismiss |
| `theme_chain` | Several notes form a recurring topic, arc, or line of thought | save insight, create index note, propose memory candidate, dismiss |
| `conflict_pair` | Two or more notes disagree on a decision, status, preference, task constraint, or project context | review, update memory, split scope, mark stale, dismiss |
| `index_note_candidate` | A scope/theme has enough material to deserve an MOC or index note | preview outline, create note, dismiss |

These items should enter Pagelet's typed Review Queue and use the Trust Layer's
Source-backed Card family.

## 4. Edge Lifecycle

Graph-aware Discovery should track edge lifecycle.

| Edge state | Meaning | Retrieval/discovery influence |
| --- | --- | --- |
| `suggested` | AI inferred a possible relation | can appear in discovery; weak influence only |
| `accepted` | user accepted or saved the relation | can participate in rerank |
| `source-backed` | relation has strong explicit source support or user-created link | strong why-shown and rerank signal |
| `rejected` | user dismissed or marked wrong | suppress similar relation unless evidence changes |
| `expired` | source changed or relation no longer applies | no influence |
| `uncertain` | weak evidence or ambiguous relation | review only; no strong rerank |

Promotion signals:

- user accepts a related note suggestion
- user creates or accepts a link
- user saves a theme chain
- user creates an index/MOC note
- repeated positive source clicks
- relation appears in multiple source-backed contexts

Demotion signals:

- user dismisses as unrelated
- source note changes invalidate the relation
- relation repeatedly appears but is not opened/saved
- conflict resolution splits scope or marks one side stale

## 5. Surfaces

### 5.1 Pagelet Review Queue

Pagelet is the primary surface.

Discovery items should appear as typed queue items:

- `related_note`
- `theme_chain`
- `conflict_pair`
- `index_note_candidate`

They can be filtered alongside Maintenance, Insight, Memory, Conflict, and Log
items.

### 5.2 Current Note Neighborhood

Current note should have a lightweight entry, not a noisy recommendation feed.

Allowed shapes:

- `Related`
- `This reminds me of...`
- `View local graph`
- source-backed related note chip

Rules:

- no automatic card pile-up while writing
- no modal interruption
- default collapsed
- user opens it intentionally or via Pagelet review

### 5.3 Local Graph UI

Local graph UI is an explanation layer.

Boundaries:

- default folded
- max 8-12 nodes
- max 1 hop
- only current card / current note / current scope
- no full-vault map
- no recursive expansion
- no user-facing ontology editor
- no requirement that users maintain graph structure

Node types:

- current note
- related note
- theme node
- conflict node
- index candidate

Edge labels:

- same folder
- shared tag
- linked
- backlink
- semantic match
- recent activity
- memory source
- conflict

## 6. Signals

Discovery uses the same lanes as Active Vault Indexer, with graph-aware
interpretation.

Signals:

- folder
- tag
- link
- backlink
- alias
- semantic similarity
- current note
- selected scope
- recent notes
- changed notes
- Pagelet Review Queue context
- Memory candidates and Confirmed Memories after Context Firewall

Signal policy:

- explicit user structure is stronger than AI-inferred structure
- semantic similarity proposes candidates but does not prove relation
- activity explains why now
- source evidence grounds final card
- excluded/private scopes are hard filters

## 7. Conflict Pair Policy

`conflict_pair` should be moderately strict.

Generate when:

- the difference affects a decision
- the difference affects status or project/scope state
- the difference affects a preference that PA may reuse
- the difference affects a task constraint
- the difference may require Memory update/stale/scope split

Avoid generating when:

- notes merely express different moods or tones
- notes are brainstorming alternatives without a decision
- semantic similarity is high but claims do not conflict
- evidence is weak or ambiguous
- conflict would be purely philosophical and not actionable

Conflict card actions:

- review sources
- update memory
- keep both
- split scope
- mark stale
- dismiss

## 8. Index Note Candidate Policy

`index_note_candidate` is the Obsidian-native bridge from discovery to durable
structure.

Generate when:

- a theme appears across several notes
- the user repeatedly opens related notes in the cluster
- there are enough sourceRefs for an outline
- the proposed note can be created as a new artifact, not by rewriting sources

Default behavior:

- generate preview outline
- list source notes
- allow edit before create
- create new index/MOC note only after confirmation
- do not move or rewrite source notes by default

This item overlaps with Maintenance Review because it can create a new note. It
must follow the Maintenance spec's write boundary and action log requirements
when implemented.

## 9. Relationship To Active Vault Indexer And Trust Layer

Active Vault Indexer provides:

- SourceRef
- RetrievalOutcome
- source/semantic/structure/activity lanes
- why-shown labels
- excluded path/tag behavior
- replay metadata

Trust Layer provides:

- Source-backed Card family
- typed Review Queue
- memory candidate/conflict lifecycle
- Context Firewall
- Replay Trace

Lightweight Graph-aware Discovery adds:

- local graph explanation UI
- discovery item types
- edge lifecycle
- conflict_pair rules
- index_note_candidate rules

## 10. Metrics

Product metrics:

- related note open rate
- related note link/save rate
- theme chain save rate
- index note candidate creation rate
- conflict pair resolution rate
- dismiss as irrelevant rate
- repeat bad relation rate
- local graph expand rate
- source click-through rate
- user correction rate for edge labels

Quality gates:

- AI-suggested edges do not strongly affect rerank until accepted/source-backed.
- Local Graph UI never shows full-vault graph by default.
- Conflict pairs cite both sides.
- Index note candidates list source notes before creation.
- Rejected edges are not repeatedly resurfaced unchanged.
- Excluded/private scopes do not contribute discovery items.

## 11. Phased Roadmap

### Phase 0: Product Contract

Status: this document.

- Define graph-aware discovery as local, review-item-centered, and bounded.
- Define item types and edge lifecycle.
- Define Pagelet and current-note surfaces.
- Define local graph UI constraints.

### Phase 1: Related Notes And Edge Lifecycle

- Generate `related_note` items in Pagelet Review Queue.
- Track edge states: suggested, accepted, rejected, expired.
- Use explicit structure + semantic + activity signals.
- No local Graph UI yet unless needed for source explanation.

### Phase 2: Theme Chains And Index Candidates

- Generate `theme_chain` items.
- Generate `index_note_candidate` items with source-backed outline preview.
- Route note creation through future write-action expansion.

### Phase 3: Local Graph Explanation UI

- Add bounded local graph for a card/scope.
- Enforce max 8-12 nodes and 1 hop.
- Show edge labels and source links.

### Phase 4: Conflict Pair Discovery

- Generate moderately strict `conflict_pair` items.
- Integrate with Trust Layer Memory Conflict workflow.
- Add user feedback loop to suppress weak conflict patterns.

### Phase 5: Rerank Integration

- Let accepted/source-backed edges influence Active Vault Indexer rerank.
- Keep suggested edges weak and discovery-only.
- Add eval fixtures for edge pollution and repeated bad suggestions.

## 12. Open Questions

- What node limit feels best in real Pagelet UI: 8, 10, or 12?
- Should `index_note_candidate` default target folder be `.pagelet/`, current folder, or user-selected?
- Should related-note acceptance automatically create an Obsidian link, or only save an edge?
- Should theme chains be allowed to become Memory Candidates?
- Should local graph UI appear in Bubble, Panel, or Tab only?

## 13. Non-goals

- No full-vault Knowledge Map in MVP.
- No graph as primary navigation.
- No user-facing ontology editor.
- No automatic Obsidian link creation from suggested edges.
- No strong rerank from unconfirmed AI-suggested edges.
- No conflict spam for ordinary brainstorming differences.
- No requirement that users clean or maintain graph data.

## 14. Summary

Lightweight Graph-aware Discovery lets PA discover relationships without making
the user manage a graph.

The intended product shape is:

- typed Pagelet discovery items
- optional current-note neighborhood entry
- bounded local graph explanation
- explicit edge lifecycle
- user structure first, AI edges second
- moderate conflict generation
- Obsidian-native index/MOC candidates

This gives PA associative intelligence while keeping the product quiet,
verifiable, and resistant to graph bloat.
