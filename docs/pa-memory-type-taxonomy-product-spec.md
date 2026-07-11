# PA Memory Type Taxonomy And Profile Boundary Product Spec

Updated: 2026-06-28

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / future implementation input |
| Status | Confirmed decision spec; implementation not started |
| Feature family | Confirmed Memory taxonomy / Profile boundary |
| Primary surfaces | Pagelet Review Queue, Memory panel, Chat/Pagelet used-memory trace, Weekly Review |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related specs | [Pagelet Trust Layer spec](./pagelet-trust-layer-product-spec.md), [PA Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |
| Related Memory docs | [VSS local state plan](./vss-local-state-plan.md), [SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md), [Embedding refresh](./vss-embedding-refresh.md) |

This spec defines the allowed v1 Confirmed Memory types and the product boundary
between useful personalization and risky user profiling. It is not current
shipped behavior.

The product definition:

> PA may remember user-confirmed context. PA must not silently construct a user
> profile from behavior.

This document records the one-question-at-a-time product decisions confirmed on
2026-06-28.

Supersession for the active iteration: the
[Memory Control Center spec](./pa-memory-control-center-product-spec.md) keeps
these types as internal policy/validation metadata rather than ordinary UI
navigation. Scope defaults to the current vault; only an explicit user action
may apply a collaboration preference across vaults on the same device.
User-facing lifecycle language is Correct, Undo recent change, Pause use, and
Forget. The sensitivity and Context Firewall rules here remain active.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| MEM-D1 | Confirmed Memory v1 uses a medium taxonomy. | Supported v1 types are `preference`, `decision`, `project_context`, `task_constraint`, and `open_question`. |
| MEM-D2 | Very limited profile-like memory is allowed only when explicitly expressed, low-sensitive, editable, deletable, and scope-limitable. | PA can remember stated preferences, but cannot infer identity/personality/values from behavior. |
| MEM-D3 | Confirmation is risk-tiered while minimizing user friction. | Ordinary low-risk memories use light confirmation; task constraints and profile-like memories use clearer confirmation; sensitive types are prohibited or special-handled. |
| MEM-D4 | Memory scope defaults to source scope and can be promoted to global by the user. | Memories do not automatically affect the whole vault. |
| MEM-D5 | Memory has lightweight temporal validity. | Use `validFrom`, `validUntil`, and `lastVerified`; UI shows simple validity state. |
| MEM-D6 | Memory updates create Conflict / Update Candidates, never silent overwrite. | User can update, keep both, split by scope, mark stale, dismiss, or create open question. |
| MEM-D7 | Memory uses sensitivity `low` / `medium` / `high`; high is not auto-used. | Context Firewall can avoid risky automatic memory use. |
| MEM-D8 | Chat/Pagelet show compact used-memory trace with expandable source and why-used details. | Memory use is transparent without overwhelming every answer. |
| MEM-D9 | Memory supports archive / forget / export with explicit lifecycle states. | Users can stop PA from using memory, preserve it without active use, or move it to Markdown without ambiguous recoverable state. |

## 1. Product Decision

Memory v1 should support enough context to make PA useful, but not enough to
turn PA into a silent personality model.

Supported v1 Confirmed Memory types:

- `preference`
- `decision`
- `project_context`
- `task_constraint`
- `open_question`

Not v1 default types:

- `relationship`
- `identity`
- `goal`
- `habit`
- `value`
- `health`
- `finance`

These excluded categories are not impossible forever. They are too sensitive,
too inferential, or too likely to make PA feel like it is profiling the user if
handled as ordinary v1 memory.

## 2. Type Definitions

| Type | Meaning | Example | Default risk |
| --- | --- | --- | --- |
| `preference` | User-stated preference for PA behavior or workflow | "Use Chinese for product discussion." | low / medium |
| `decision` | User-confirmed decision that should be remembered in a scope | "Weekly Review lives in Pagelet Tab." | low / medium |
| `project_context` | Scope-bound state or context for a project/topic/workstream | "This feature is deferred until after Pagelet review." | medium |
| `task_constraint` | Constraint that should affect future task/action choices | "Do not auto-archive notes in this folder." | medium / high |
| `open_question` | Unresolved question the user wants PA to keep visible | "When should scoped autonomy replace review?" | low / medium |

### 2.1 Preference

Preference should be explicit and low-risk.

Allowed:

- "Answer me more directly."
- "Use Chinese for product discussion."
- "Default quick capture to Daily Note."
- "Prefer source-backed answers."

Not allowed:

- "User is impatient" inferred from short replies.
- "User dislikes meetings" inferred from skipped meeting notes.
- "User is a night person" inferred from usage time.

### 2.2 Decision

Decision memory should preserve user-confirmed product/work/personal decisions.

Rules:

- must have sourceRefs
- must have scope
- should include date
- should not be global unless the user chooses global

### 2.3 Project Context

Project context is local by default.

Use for:

- feature state
- project phase
- deferred work
- current direction
- known constraints

Do not assume the vault has formal projects. Scope can be folder, tag, selected
notes, saved scope, or Weekly Review scope.

### 2.4 Task Constraint

Task constraints affect future PA action choices and therefore need clearer
confirmation.

Examples:

- "Never modify notes in this folder without preview."
- "Archive only after I approve."
- "For this scope, batch low-risk link fixes are okay."

Task constraints should be easy to inspect and revoke.

### 2.5 Open Question

Open questions help PA keep unresolved thinking visible.

They may influence:

- Quiet Recall
- Weekly Review
- Saved Insight suggestions
- review prompts

They should not become a statement of user preference.

## 3. Profile Boundary

v1 allows very limited profile-like memory only when all conditions are true:

- the user explicitly expressed it
- it is low-sensitive
- it is useful for PA behavior
- it is editable
- it is deletable
- it can be scope-limited
- it is visible in Memory panel

Allowed:

- "Use fewer pleasantries."
- "When explaining code, show the diff first."
- "Prefer Markdown artifacts for product specs."

Not allowed in v1 as ordinary memory:

- inferred identity
- inferred personality
- inferred values
- inferred habits
- inferred health
- inferred finances
- inferred relationships
- inferred psychological state
- inferred broad life goals

Product rule:

> Behavior is not consent. Repeated behavior does not automatically become user
> profile memory.

## 4. Confirmation Policy

Confirmation should be risk-tiered, but not heavy by default.

| Memory category | Confirmation |
| --- | --- |
| Low-risk `preference` | light confirm/edit/dismiss |
| Low-risk `decision` | light confirm/edit/dismiss |
| Scope-bound `project_context` | light confirm, with visible scope |
| `open_question` | light save/keep/dismiss |
| `task_constraint` | clearer confirmation because it can affect actions |
| profile-like preference | explicit wording: "This will affect how PA serves you" |
| high-sensitivity content | prohibit by default or special review path |

Do not show a heavy modal for every memory. The user should see what will be
remembered, where it applies, and how to undo it.

## 5. Scope Policy

Memory defaults to the source scope.

Possible scopes:

- current note
- selected notes
- folder
- tag
- time range / Weekly Review scope
- saved scope
- global, only after user promotion

Default:

- source scope, not global

User actions:

- keep source scope
- narrow scope
- widen scope
- promote to global
- restrict from a scope

Context Firewall should use scope to decide whether a memory is:

- auto-included
- ask-user
- dropped

## 6. Temporal Validity

Memory should include lightweight temporal validity.

Fields:

- `validFrom`
- `validUntil`
- `lastVerified`

Simple UI states:

- still valid
- may be stale
- expired
- recently verified

Do not build a full timeline UI in v1.

## 7. Update And Conflict Policy

Memory should not be silently overwritten.

When new evidence conflicts with existing memory, create:

- Memory Conflict Card; or
- Memory Update Candidate

Allowed outcomes:

- update existing memory
- keep both
- split by scope
- mark old stale
- dismiss new evidence
- create open question

This preserves trust and avoids invisible profile drift.

## 7.1 Lifecycle States And User Copy

Confirmed Memory needs explicit lifecycle states before implementation.

| State | Meaning | Can PA use it? | User recovery |
| --- | --- | --- | --- |
| `candidate` | Proposed memory awaiting review | no | accept/edit/dismiss |
| `active` | Confirmed Memory eligible for use within scope and sensitivity policy | yes | edit/archive/forget/export |
| `archived` | Preserved but inactive | no by default | restore or export |
| `stale` | Active or archived memory that may no longer apply | ask/drop depending on task | verify/update/archive/forget |
| `forgotten_tombstone` | Content removed; minimal local marker retained to avoid re-suggesting the same memory | no | clear deletion markers from advanced cleanup |
| `exported` | Written to a user-visible Markdown artifact | not automatically; depends on generated/source policy | managed as vault content |

User actions:

| Action | Product meaning | Storage effect |
| --- | --- | --- |
| Archive | "Keep it, but do not use it." | Move memory to `archived`; retain content and sourceRefs for Memory panel only. |
| Forget / delete | "Stop using this and remove its memory content." | Remove memory content from active/archive stores; keep only a text-free tombstone unless the user clears deletion markers. |
| Export | "Turn this into my own note/artifact." | Write a user-confirmed Markdown artifact with sourceRefs; memory can remain active, be archived, or be forgotten by separate user choice. |
| Clear deletion markers | "Allow PA to suggest similar memories again." | Deletes tombstones; does not restore forgotten memory content. |

Suggested user copy for forget:

```text
Forget this memory?

PA will stop using it and remove the saved memory text. A small local deletion
marker may remain so PA does not suggest the same memory again. You can clear
deletion markers later from Data & Privacy.
```

Rules:

- `archive` is reversible.
- `forget/delete` removes memory content and is not content-recoverable from PA
  state.
- tombstones must not contain raw memory text, private excerpts, or full
  source content.
- exported Markdown is user-owned vault content and follows vault/source rules.
- clearing local Memory index must not delete Confirmed Memory.

## 8. Sensitivity

Memory uses lightweight sensitivity.

| Sensitivity | Meaning | Default behavior |
| --- | --- | --- |
| `low` | Low-risk preference, decision, or context | eligible for auto-include if scope fits |
| `medium` | Affects task choice, cross-scope behavior, or may mislead if stale | may require ask-user depending on task |
| `high` | identity, health, finance, relationship, legal, psychological state, values, deep profile | not auto-used; prohibited or special-confirmed in v1 |

High sensitivity should not flow through ordinary Memory Candidate review.

If high-sensitivity content appears relevant, PA should either:

- keep it as source evidence only
- ask the user explicitly
- avoid saving it as Confirmed Memory

## 9. Used-memory Trace

Chat and Pagelet should show compact memory-use transparency.

Default:

- `Used 2 memories`
- `1 memory not used because it may be stale`
- `Memory used from this Pagelet scope`

Expanded view:

- memory summary
- type
- sourceRefs
- scope
- sensitivity
- why-used
- why-dropped, if applicable
- stale/conflict signal
- open Memory panel action

Do not show every memory in full by default.

## 10. Forget / Archive / Export

Users must control what PA remembers.

### 10.1 Forget

Forget means:

- stop using the memory
- remove it from active Confirmed Memory
- optionally clear local object depending on implementation policy
- keep only minimal audit if needed for safety/debug, and disclose that if so

### 10.2 Archive

Archive means:

- preserve the memory object
- do not proactively use it
- keep it available in Memory panel
- allow restore

### 10.3 Export

Export means:

- write the memory to Markdown by user action
- include sourceRefs when available
- optionally remove from active PA Memory afterward

Export is useful when the user wants a memory to become a vault artifact rather
than behavioral context.

## 11. Data Model Notes

Suggested fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable memory id |
| `type` | preference, decision, project_context, task_constraint, open_question |
| `summary` | User-visible memory text |
| `sourceRefs` | Evidence sources |
| `scope` | Source scope by default |
| `sensitivity` | low, medium, high |
| `confidence` | Optional coarse confidence |
| `validFrom` | Start of validity |
| `validUntil` | End of validity, if known |
| `lastVerified` | Last user/system verification |
| `updatePolicy` | manual-only, suggest-update-on-conflict, expire-after-date, refresh-on-scope-review, ask-before-cross-scope-use |
| `status` | active, archived, stale, forgotten |
| `confirmationStrength` | light, explicit, special |
| `profileBoundary` | none, explicit-low-risk-profile-like, prohibited-sensitive |
| `createdAt` | Creation timestamp |
| `updatedAt` | Last update timestamp |
| `confirmedAt` | User confirmation timestamp |
| `confirmationSource` | Pagelet, Weekly Review, Chat request, Memory panel |

## 12. Relationship To Trust Layer

This spec refines Trust Layer memory policy.

Trust Layer owns:

- Evidence-to-Memory lifecycle
- Memory Candidate review
- Context Firewall
- Memory Conflict Cards
- storage boundary
- replay trace

This spec adds:

- v1 type taxonomy
- profile boundary
- confirmation strength by type/risk
- default scope rule
- temporal validity UI contract
- forget/archive/export behavior

## 13. Relationship To Weekly Review

Weekly Review is a primary memory review surface.

Weekly Review can:

- group Memory Candidates by type/scope/risk
- batch-confirm low-risk candidates
- require individual review for task constraints, profile-like, conflict, or
  high-sensitivity candidates
- write accepted memory updates to Weekly Review note only as accepted items

## 14. Relationship To Saved Insight

Saved Insight is not Memory.

Saved Insight may be promoted to Memory Candidate only after user action.

Promotion should create:

- sourceRefs
- proposed memory type
- proposed scope
- sensitivity
- confirmation prompt appropriate to risk

## 15. Data Boundary And Privacy

Memory taxonomy must obey Data Boundary.

Rules:

- excluded folders/tags cannot seed memory unless user overrides explicitly
- provider disclosure applies when AI extracts candidates
- high-sensitivity profile inference is prohibited or special-handled
- Memory panel must allow clear/forget/archive/export
- data cleanup separates unconfirmed candidates and Confirmed Memories

Do not use Memory to bypass privacy exclusions.

## 16. Evaluation

Eval Harness should test memory taxonomy and boundary behavior.

Suggested cases:

| Case | Expected behavior |
| --- | --- |
| Explicit low-risk preference | Light confirmation; low sensitivity |
| Behavior-only pattern | No profile memory created |
| Project context | Source-scope default, not global |
| Task constraint | Clearer confirmation |
| Open question | Saved as open_question, not preference |
| Sensitive inferred health/finance/identity | Not ordinary Confirmed Memory |
| New contradictory evidence | Memory Conflict / Update Candidate |
| Used-memory trace | Shows compact used memory and expandable why-used |
| Forget | Memory stops influencing PA |
| Archive | Memory preserved but not proactively used |

Deterministic checks:

- no behavior-only inferred profile memory
- default scope is not global
- high sensitivity is not auto-used
- update does not silently overwrite
- used-memory trace exists when memory affects output

## 17. Roadmap

### Phase 0: Product Contract

- Link this spec from Trust Layer, Weekly Review, Data Boundary, Eval Harness,
  and coverage audit.
- Keep v1 memory types limited.

### Phase 1: Type And Scope Contract

- Add v1 type enum.
- Default scope to source scope.
- Add sensitivity field.
- Add temporal validity fields.

### Phase 2: Confirmation UX

- Add light confirmation for low-risk memories.
- Add clearer confirmation for task constraints and explicit profile-like
  preferences.
- Block or special-handle high-sensitivity inferred content.

### Phase 3: Memory Panel Governance

- Show type/scope/sensitivity/validity.
- Support edit, limit scope, mark stale, forget, archive, export.

### Phase 4: Used-memory Trace

- Show compact trace in Chat/Pagelet.
- Expand to sourceRefs and why-used/why-dropped.

### Phase 5: Eval Fixtures

- Add synthetic fixtures for behavior-only inference, stale memory, conflict,
  scope mismatch, and sensitivity boundary.

## 18. Open Questions

- Resolved: keep canonical v1 type `project_context`. It may represent folder,
  tag, saved scope, selected notes, or topic/workstream context; it does not
  require a formal Project model.
- What exact copy should explain profile-like memories without scaring users?
- Should `open_question` live in Memory, Saved Insight, or both?
- How long should unverified low-risk preferences remain valid by default?
- Resolved: forgotten memory leaves a text-free tombstone by default to prevent
  re-extraction, and the user can clear deletion markers from advanced cleanup.
- Should exported memories be excluded from future memory extraction by default?

## 19. Summary

Memory Taxonomy keeps PA useful without making it creepy.

The durable contract:

- v1 types: preference, decision, project_context, task_constraint, open_question
- no silent behavior-inferred profile memory
- very limited explicit low-risk profile-like memory allowed
- risk-tiered confirmation with low friction
- source scope by default, global only by user promotion
- lightweight temporal validity
- no silent overwrite
- low / medium / high sensitivity
- compact used-memory trace
- forget / archive / export user control

This gives PA memory with a spine: useful enough to personalize, restrained
enough to trust.
