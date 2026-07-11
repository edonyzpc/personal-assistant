# Pagelet Trust Layer Product Spec

Updated: 2026-06-29

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / future implementation input |
| Status | Draft decision spec |
| Primary surfaces | Pagelet, Memory panel, Chat |
| Feature family | Trust Layer |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related retrieval substrate | [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md) |
| Related Pagelet docs | [Pagelet product design](./pagelet-product-design.md), [PA Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Context Pager spec](./pa-context-pager-product-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [Pagelet Maintenance Review spec](./pagelet-maintenance-review-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [Pagelet async result plan](./pagelet-async-result-plan.md) |
| Related Memory docs | [VSS local state plan](./vss-local-state-plan.md), [SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md), [Embedding refresh](./vss-embedding-refresh.md) |
| Product doctrine | [Low-Burden Review Product Principles](./pa-low-burden-review-product-principles.md) |

This spec defines the product layer that makes PA's insights, memories, and
future actions trustworthy. It is not current shipped behavior.

The Trust Layer is the companion to Maintenance Review:

- Maintenance Review defines how PA's hands safely maintain the vault.
- Trust Layer defines how PA's brain uses evidence, remembers, forgets, and
  explains itself without becoming a black box.

Memory-specific supersession: the active
[Memory Control Center spec](./pa-memory-control-center-product-spec.md)
replaces standalone Memory-panel ownership and blanket confirmation assumptions
with unified Settings governance and effect-based admission. This document's
Evidence/Memory distinction, source provenance, Context Firewall, and Pagelet
candidate-review responsibilities remain active and feed the real prompt-use
gate.

## 1. Product Decision

The Trust Layer should not be a separate top-level product page named "Trust".
It should be a set of product objects and workflows used across Pagelet, Memory,
Chat, and Maintenance.

Core decision:

> Evidence and Memory can share one card family in UI, but they must remain
> separate product states with different lifecycle consequences.

Evidence answers:

- Why is PA saying this now?
- Which source notes support it?
- What is the evidence strength?
- What should the user do next?

Memory answers:

- Can PA use this later as a durable fact, preference, decision, constraint, or
  scope state?
- Who confirmed it?
- Where does it apply?
- When does it expire?
- What should happen if new evidence conflicts with it?

## 2. Product Principles

### 2.1 Evidence Supports The Present, Memory Changes The Future

Evidence is about a current claim, insight, answer, or proposal.

Memory is about future PA behavior.

This distinction is the trust boundary. A source-backed statement can be useful
without becoming something PA should remember permanently.

Rule:

> Evidence can be promoted to Memory, but Evidence is not Memory by default.

### 2.2 One Review Surface, Typed Workflows

Pagelet should own a unified Review Queue, but every queue item must have a
clear type.

The user should not need to visit separate inboxes for cleanup, insights,
memories, conflicts, and logs. But the UI must not flatten them into generic
"AI suggestions".

Rule:

> Queue is unified; workflow is type-specific.

Queue entry is constrained:

> Evidence can be shown without becoming a queue item. Queue is for
> user-kept intent or durable consequence.

Examples:

- A source-backed recall cue can be read and closed with no queue state.
- A PA-discovered insight candidate enters the queue only when the user keeps
  it or when it is proposed for Saved Insight, Memory, Markdown, maintenance,
  or another durable flow.
- A Memory Candidate enters the queue because it may affect future PA behavior.
- A Maintenance Proposal enters the queue because it may mutate the vault.

### 2.3 Confirmed Memory Still Needs Context Gating

Confirmed Memory is not automatically included in every prompt. Personal
knowledge is fragile: a fact can be true and still irrelevant, stale, sensitive,
or wrong for the current scope.

Rule:

> Confirmed Memory must pass Context Firewall on every use.

### 2.4 Conflicts Are Reviewed, Not Silently Overwritten

Personal memory should evolve, but it must not mutate silently.

Rule:

> When new evidence conflicts with Confirmed Memory, PA creates a Memory
> Conflict Card instead of overwriting the old memory.

### 2.5 Memory Is Visible But Not Vault-polluting By Default

Memory should not be a hidden profile, and it should not fill the vault with
machine state by default.

Rule:

> Confirmed Memory defaults to local store and is managed through the Memory
> panel. User-selected memory artifacts may be exported or saved to the vault.

## 3. Surfaces And Responsibilities

| Surface | Trust Layer role | User actions |
| --- | --- | --- |
| Pagelet | Discover, review, and confirm candidates | save, remember, confirm, edit, dismiss, snooze, resolve conflict |
| Memory panel | Manage Confirmed Memory | view, edit, limit scope, mark stale, forget, export |
| Chat | Lightweight trigger and explanation | remember this, do not remember, show used memory, why was this used |
| Maintenance Review | Uses evidence and logs for action trust | view source, inspect diff, apply, undo, mark wrong |

Product split:

- Pagelet is where memory candidates and conflicts are born and reviewed.
- Memory panel is where durable memory is inspected and managed.
- Chat should not become the main memory-management UI.
- Maintenance proposals use the same source-backed card and review queue model.

## 4. Source-backed Card Family

Use one visual card family for evidence, insight, and memory states.

Common fields:

- title or claim
- type badge
- sourceRefs
- source excerpts
- why now / why relevant
- confidence
- scope
- sensitivity
- status
- primary actions
- secondary actions

Card states:

| State | Product meaning | Typical actions |
| --- | --- | --- |
| `evidence` | source-backed support for a current answer, insight, or proposal | open sources, save insight, remember, dismiss |
| `saved_insight` | user saved this as a useful insight, but not as durable memory | open, edit, promote to memory, dismiss |
| `memory_candidate` | PA proposes that this may be useful later | confirm, edit, limit scope, dismiss, later |
| `confirmed_memory` | user-approved durable memory | edit, mark stale, forget, export |
| `memory_conflict` | new evidence conflicts with old memory | update, keep both, split scope, mark stale, dismiss |
| `stale_memory` | memory may no longer apply | refresh, confirm still true, forget |

Example Evidence card:

```text
Insight
You are converging on Pagelet as the global review surface.

Sources:
- PA Agent research report
- Pagelet Maintenance Review spec
- Recent product discussion

Why now:
You are deciding how Memory, Maintenance, and Review should share one surface.

Actions:
Open sources / Save insight / Remember this / Dismiss
```

Example Memory Candidate after promotion:

```text
Memory candidate
Pagelet should be the global review surface for Maintenance, Insights, and
Memory candidates.

Type: Decision
Scope: PA Agent / Pagelet
Sources: ...
Confidence: High
Validity: until changed

Actions:
Confirm memory / Edit / Limit scope / Dismiss
```

## 5. Review Queue Types

Pagelet should use one Review Queue with typed items. The canonical item type
set lives in [PA Product Information Architecture](./pa-product-information-architecture-spec.md);
the table below is the Trust Layer subset.

| Review Item Type | Meaning | Primary actions |
| --- | --- | --- |
| `maintenance_proposal` | vault maintenance action proposal | accept, edit, dismiss, apply |
| `evidence_insight` | user-kept or durable source-backed insight / recall handoff | save, remember, dismiss |
| `memory_candidate` | candidate durable memory | confirm, edit, limit scope, dismiss, later |
| `memory_conflict` | old memory and new evidence disagree | update, keep both, split scope, mark stale |
| `review_summary` | periodic or scope summary | save note, share to memory, dismiss |
| `action_log` | applied action or recoverable change | view, undo, mark okay |

Suggested filters:

- All
- Cleanup
- Insights
- Memory
- Conflicts
- Logs

- Suggested groups:

- Kept for later
- Actions to confirm
- Recently applied
- Snoozed
- Stale

Weekly prepared review should start as a digest. It creates typed queue items
only for user-kept material or action-bearing items, not for every generated
candidate. The user may choose to save a summary note after selecting what to
keep.

## 6. Evidence-To-Memory Lifecycle

Trust Layer state machine:

```text
Evidence
  -> Saved Insight
  -> Memory Candidate
  -> Confirmed Memory
  -> Updated / Stale / Forgotten
```

Not every item follows the full path:

- a source citation in Chat may remain `evidence`
- a useful observation may become `saved_insight`
- a repeated decision or preference may become `memory_candidate`
- only user-confirmed items become `confirmed_memory`
- later evidence may mark memory as `updated`, `stale`, or `forgotten`

Promotion rules:

| From | To | Trigger |
| --- | --- | --- |
| evidence | saved_insight | user explicitly saves it as an insight |
| evidence | memory_candidate | user clicks `Remember this` or PA proposes with evidence |
| saved_insight | memory_candidate | PA detects future-use value or user promotes it |
| memory_candidate | confirmed_memory | user confirms after reviewing fields |
| confirmed_memory | memory_conflict | new evidence appears inconsistent |
| confirmed_memory | stale_memory | validity expires or user marks stale |
| stale_memory | confirmed_memory | user confirms it still applies |
| confirmed_memory | forgotten | user forgets/deletes it |

A saved review note is a traceable Markdown history artifact. Including
evidence in a review note does not by itself create a Saved Insight or Review
Queue item.

## 7. Memory Candidate Policy

PA may proactively generate Memory Candidates from ordinary notes, Pagelet
reviews, and Chat, but it may not automatically solidify them into Confirmed
Memory.

Allowed candidate sources:

| Source | Candidate generation | Notes |
| --- | --- | --- |
| Ordinary notes | allowed | must have sourceRefs and avoid high-risk inference |
| Pagelet review / insight | allowed | best default source because user is already reviewing |
| Chat conversation | allowed, more cautious | avoid treating temporary conversation as durable fact |
| Maintenance decisions | allowed | useful for scope policies and vault preferences |

Candidate requirements:

- `summary`
- `type`
- `sourceRefs`
- `scope`
- `confidence`
- `reason`
- `validFrom`
- `validUntil` when known
- `lastVerified`
- `sensitivity`
- `updatePolicy`

Initial Memory Candidate types:

| Type | Meaning | Example |
| --- | --- | --- |
| `decision` | durable product/work decision | "Maintenance lives inside Pagelet." |
| `preference` | user preference for product/work style | "User prefers one-question-at-a-time product discussion." |
| `task_constraint` | constraint that should guide future work | "Maintenance excludes external actions." |
| `open_question` | unresolved question worth carrying forward | "Where should action logs be stored?" |
| `project_context` | current state of a folder/topic/scope | "Inbox cleanup is pending for this vault." |

Do not generate or persist as first-class Memory in v1:

- personality profile
- psychological traits
- health inference
- relationship inference
- financial inference
- broad life-goal inference
- sensitive identity or demographic inference

If a high-sensitivity item appears relevant, PA should ask the user directly or
keep it as evidence only. It should not nudge the user to turn it into durable
memory by default.

## 8. Confirmed Memory Fields

Confirmed Memory should be typed, scoped, source-backed, temporal, and editable.

Recommended schema:

```text
Memory
  id
  type
  summary
  sourceRefs
  scope
  sensitivity
  confidence
  validFrom
  validUntil
  lastVerified
  updatePolicy
  status
  createdAt
  updatedAt
  confirmedAt
  confirmationSource
```

`updatePolicy` examples:

- `manual-only`
- `suggest-update-on-conflict`
- `expire-after-date`
- `refresh-on-scope-review`
- `ask-before-cross-scope-use`

User actions:

- Confirm
- Edit
- Limit scope
- Mark stale
- Forget
- Export to note
- Create decision note

## 9. Context Firewall

Context Firewall is the retrieval-time gate for Confirmed Memory.

It should output:

- `auto-include`
- `ask-user`
- `drop`

Decision dimensions:

| Gate | Question |
| --- | --- |
| Scope match | Does this memory belong to the current note, folder, task, or topic? |
| Time validity | Is it within validFrom / validUntil and recently verified enough? |
| Sensitivity | Is it safe to use in this context? |
| Conflict | Does newer evidence contradict it? |
| Confidence | Is it reliable enough for this task? |
| User correction | Has the user said not to use this here? |
| Task fit | Is the current task retrieval, writing, maintenance, decision, or casual chat? |

Reason labels:

- `scope-match`
- `topic-mismatch`
- `time-stale`
- `preference-conflict`
- `scope-sensitive`
- `low-evidence`
- `user-corrected`
- `privacy-excluded`
- `task-mismatch`

User-facing wording should be simple:

- `Used because it matches this Pagelet scope.`
- `Needs confirmation because it may be stale.`
- `Not used because it belongs to another scope.`
- `Not used because you dismissed similar memories here.`

Do not expose technical retrieval jargon such as vector score, top-k, reranker,
or embedding unless the user opens a developer/debug view.

## 10. Memory Conflict Cards

When new evidence conflicts with Confirmed Memory, PA should create a
`memory_conflict` review item instead of automatically replacing the old memory.

Conflict categories:

| Category | Meaning | Example |
| --- | --- | --- |
| Replacement | new evidence likely supersedes old memory | user changes a previous product decision |
| Refinement | new evidence adds conditions | manual-first remains default, but authorized scopes can execute-first |
| Context split | both are true in different scopes | drafts are suggestion-only; inbox can auto-clean |

Card shape:

```text
Memory conflict

Existing:
Maintenance should be manual-first.

New evidence:
Inbox cleanup may become execute-first after repeated confirmed plans.

Suggested update:
Manual-first remains default. Execute-first is allowed only for authorized
scopes with action log and undo.

Actions:
Update / Keep both / Split by scope / Mark old stale / Dismiss
```

Conflict resolution outcomes:

- update existing memory
- keep both
- split by scope
- mark old stale
- dismiss new evidence
- create open question

## 11. Storage Boundary

Trust Layer should use mixed storage.

Decision:

> Confirmed Memory defaults to local store. User-visible summaries and selected
> durable artifacts may be written to the vault.

Recommended split:

| Data | Storage | Reason |
| --- | --- | --- |
| runtime/index memory | local DB/cache | retrieval and context selection |
| memory candidates | local review queue | reviewable, not durable yet |
| confirmed memory | local store + Memory panel | visible without polluting vault |
| memory conflicts | local review queue | needs user resolution |
| saved insight | local store; optional explicit Markdown export/review note inclusion | avoids turning every review note into future work |
| decision/project notes | user-selected vault artifact | syncable and auditable |
| full hidden provider output | do not persist | privacy and drift risk |

This follows the repo's broader local-state principle: local runtime state should
not create or update vault files by default, and the Markdown vault remains the
source of truth for user-authored notes.

Export options:

- `Export selected memory to note`
- `Create decision note`
- `Save weekly memory review`
- `Save insight ledger note`

Sensitive memories should not be exported as plain Markdown by default.

## 12. Replay Trace

Replay Trace is the evidence trail for important outputs. It should not be the
main UI, but it must exist for inspection, debugging, and product evaluation.

Trace levels:

| Level | User visibility | Contents |
| --- | --- | --- |
| Compact | default expandable UI | sources used, memories used, why shown |
| Detailed | advanced inspection | scope, query rewrite, included/skipped notes, memory gate decisions |
| Debug | developer/eval only | provider, model, latency, cost, retrieval diagnostics |

Recommended fields:

- `answerId` or `itemId`
- `surface`
- `taskKind`
- `scope`
- `query`
- `queryRewrite`
- `selectedSources`
- `skippedSources`
- `usedMemories`
- `droppedMemories`
- `contextFirewallReasons`
- `model`
- `provider`
- `latency`
- `cost`
- `createdAt`
- `userFeedback`

Replay Trace should support:

- "Why did PA say this?"
- "Which Memory was used?"
- "Why was this Memory ignored?"
- "Which notes were excluded?"
- "Was this based on old or conflicting information?"

## 13. Privacy And Data Boundaries

The Trust Layer is privacy-sensitive because it can create user models.

Requirements:

- No hidden user-profile writes.
- Candidate Memory must be visible before becoming Confirmed Memory.
- Confirmed Memory must be editable and forgettable.
- Sensitive folder exclusions apply to evidence, candidates, memory, and replay.
- Provider calls must respect the same scope preview and excluded-path rules as Pagelet.
- High-sensitivity inference should not become Memory Candidate by default.
- Users need a clear answer to: "What does PA know about me?"

Memory panel minimum:

- All confirmed memories grouped by type and scope.
- Search/filter by type, scope, sensitivity, status.
- Edit / forget / mark stale.
- View sources.
- View last used time if available.
- Export selected items.

## 14. Metrics

Trust Layer quality should measure trust, not only model output quality.

Core metrics:

- source click-through rate
- saved insight rate
- memory candidate confirmation rate
- edit-before-confirm rate
- memory candidate dismissal rate
- memory conflict resolution rate
- stale memory detection rate
- wrong-context memory injection rate
- context firewall ask/drop rate
- user correction rate
- "what does PA know about me?" discoverability
- replay trace completeness

Quality gates:

- no Confirmed Memory without user confirmation
- every Memory Candidate has sourceRefs
- every Confirmed Memory has scope and update policy
- Context Firewall reason exists for used/dropped important memories
- conflicts do not silently overwrite Confirmed Memory
- sensitive excluded paths do not generate candidates

## 15. Phased Roadmap

### Phase 0: Product Contract

Status: this document.

- Define Source-backed Card family.
- Define unified Review Queue item types.
- Define Evidence-to-Memory lifecycle.
- Define Memory Candidate policy.
- Define Context Firewall product contract.
- Define storage boundary and Memory panel responsibilities.

### Phase 1: Source-backed Cards + Saved Insights

- Add or formalize source-backed card fields in Pagelet.
- Support save/dismiss actions for evidence insights.
- Store saved insights locally; optional Markdown/review-note inclusion is a
  separate explicit write action.
- Add compact "why shown" and source excerpt UI.

### Phase 2: Memory Candidates In Pagelet Queue

- Add `memory_candidate` review item type.
- Generate candidates from Pagelet review and selected notes.
- First candidate types: decision, preference, task constraint, open question, scope state.
- Require user confirm/edit/dismiss/later.

### Phase 3: Memory Panel For Confirmed Memory

- Show Confirmed Memory grouped by type and scope.
- Allow edit, forget, mark stale, limit scope, export.
- Answer "what does PA know about me?"
- Keep default storage local.

### Phase 4: Context Firewall

- Gate Confirmed Memory with `auto-include / ask-user / drop`.
- Add reason labels and user-facing explanations.
- Show used memories in Chat/Pagelet compact trace.
- Add "do not use this here" feedback.

### Phase 5: Memory Conflict Cards

- Detect candidate conflicts with Confirmed Memory.
- Add `memory_conflict` queue item type.
- Support update / keep both / split scope / stale / dismiss.
- Track conflict resolution as preference signal.

### Phase 6: Replay Trace

- Add compact replay trace for important answers, insights, and memory-affecting items.
- Add detailed trace for advanced inspection.
- Connect trace to evaluation harness.

## 16. Open Questions

- Should saved insights default to local store, `.pagelet/` review notes, or both?
- Which Memory Candidate type should ship first: `decision` or `preference`?
- How should Memory panel and existing Memory/VSS settings coexist in navigation?
- How long should unused Confirmed Memory remain active before refresh is requested?
- Should Chat be allowed to inline-confirm low-risk Memory Candidates, or always route to Pagelet?
- What should the first "what does PA know about me?" screen look like?
- How much Replay Trace should be visible to non-technical users?

## 17. Non-goals

- No personality or digital twin system.
- No automatic user-profile writes.
- No high-sensitivity inference as default Memory Candidate.
- No full hidden provider-output persistence.
- No user-facing graph ontology editor.
- No separate Trust tab in MVP.
- No automatic overwrite of Confirmed Memory.
- No assumption that citation alone is sufficient trust.

## 18. Summary

The Trust Layer turns PA from a clever generator into a reliable personal
knowledge system.

The intended product shape is:

- one Source-backed Card family
- one typed Pagelet Review Queue
- clear Evidence-to-Memory lifecycle
- Pagelet for candidate review
- Memory panel for durable memory management
- Chat for lightweight triggers and explanations
- Context Firewall for retrieval-time safety
- Memory Conflict Cards for safe evolution
- mixed storage with local default and user-chosen vault artifacts
- Replay Trace for inspection and evaluation

This makes PA's memory useful without making it secretive or overconfident.
