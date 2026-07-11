# PA Memory Control Center Product Intake And Promotion Record

Updated: 2026-07-11

## Status

| Field | Value |
| --- | --- |
| Document type | Historical product intake / decision provenance |
| Status | Promoted; runtime, validation, and closeout complete |
| Product intake decisions | Complete |
| Trigger | User product discussion on 2026-07-10 |
| Reference | Qoder Work memory settings page shared by the user |
| Primary areas | Memory, Settings, Pagelet, Chat, Data Boundary |
| Confirmed scope decision | Share only a thin collaboration layer across vaults; defer cross-vault understanding |
| Implementation authority | Product spec, plan, SDD, and tracker; this document remains decision provenance only |

This document preserves the original product-intake decisions. The user selected
the work for a subsequent iteration on 2026-07-10. Active implementation
authority and execution state now live in:

- [Product spec](./pa-memory-control-center-product-spec.md)
- [Development plan](./pa-memory-control-center-development-plan.md)
- [Implementation SDD](./pa-memory-control-center-sdd.md)
- [Development tracker](./pa-memory-control-center-development-tracker.md)

Promotion does not by itself authorize unsafe data migration, release,
publication, or edits that mix with separately owned uncommitted work.

Implementation phase, gate, and completion status are authoritative only in
the active product spec, development plan, SDD, and tracker linked above.

Promotion interpretation after independent review:

- Type-C Vault Insights is the first typed source for derived note observations;
- migration preserves legacy effective behavior and never bulk-activates stored
  Confirmed Memory;
- same-device cross-vault collaboration requires an explicit user scope action;
- the read-only Overview began as an internal/feature-gated milestone and was
  promoted only after canonical lifecycle/use/recovery behavior existed.

## Product Signal

The Qoder Work memory settings page is a useful reference because it turns an
otherwise opaque memory system into one low-frequency, inspectable control
surface. Its useful qualities are:

- one place to understand what the assistant retains;
- ordinary operation is automatic rather than management-heavy;
- important layers have short summaries and on-demand detail;
- recent additions, replacements, and removals are inspectable;
- storage, repair, export, and restore remain available when needed.

The reference should inform PA's information architecture, not be copied as a
file taxonomy or visual specification.

## Product Relationship To Preserve

PA should continue to treat understanding the user's notes as its foundation.
Its understanding of the user is a derived, evolving outcome of those notes and
ongoing interaction, not a second product competing with note Memory.

The intended relationship is:

```mermaid
flowchart LR
  A["Notes and interaction"] --> B["Source-backed observations"]
  B --> C["PA's revisable understanding of the user"]
  C --> D["Better recall and more coherent collaboration"]
```

This does not mean every note statement becomes a user attribute. Book excerpts,
client records, opposing arguments, research topics, and temporary project rules
must not silently become global identity, value, preference, or permission
claims.

## Confirmed Product Decisions

The user confirmed the initial scope model on 2026-07-10:

1. **Thin cross-vault collaboration layer**
   - Only durable collaboration preferences that the user explicitly applies
     across all vaults on the same device should be shared across vaults.
   - Examples include preferred language, answer structure, evidence standard,
     and stable collaboration expectations.
2. **Vault-scoped derived understanding by default**
   - Understanding inferred from notes, vault structure, or project work remains
     scoped to the current vault unless the user later chooses otherwise.
   - It must not silently become a global identity, value, preference, or
     constraint.
3. **Task context remains temporary**
   - One-turn or task-specific constraints do not become durable collaboration
     preferences merely because they appeared in conversation.
4. **Cross-vault understanding is deferred**
   - PA may consider cross-vault synthesis in a later product phase, but it is
     not part of the initial Memory control-center scope.
   - Reconsideration requires a separate value, privacy, source-boundary,
     conflict, sync, and migration decision.
5. **No implied action authority**
   - No collaboration preference, vault understanding, or future cross-vault
     synthesis grants vault-write or external-action permission.
6. **Quiet-update policy is based on effect, not Memory type**
   - Source-backed, non-sensitive, reversible understanding that stays within the
     current vault and only improves retrieval or recall may update quietly.
   - Low-risk understanding that persistently changes future answers may update
     without a blocking prompt only when it appears in Recent changes and remains
     easy to correct or undo.
   - Cross-vault or global effects, sensitive inference, and durable task
     constraints must be surfaced before they influence future behavior.
   - Memory must never infer vault-write, network, or external-action authority.
7. **Recent changes is an audit and recovery log, not a review queue**
   - It must not create unread counts, persistent badges, pending states, or an
     expectation that the user reviews every change.
   - It should remain a low-frequency, on-demand explanation of meaningful
     additions, replacements, and removals.
   - Each meaningful entry should expose source, scope, effect, time, and the
     relevant correction, undo, or prevent-relearning action.
   - Items requiring prior user action do not belong here as disguised pending
     work; they must use the appropriate explicit decision surface.
8. **Use a provisional seven-day audit and undo window**
   - Recent changes should show meaningful changes from the previous seven days.
   - Detailed local snapshots needed to undo additions, replacements, or removals
     should be retained for seven days in the first implementation.
   - The text-free prevent-relearning marker does not expire after seven days; it
     remains until the relevant source evidence changes materially or the user
     clears it.
   - These lifecycles never modify or delete the source notes.
   - Seven days is an initial dogfood hypothesis, not a permanent promise. Revisit
     it using undo timing, inspection cadence, snapshot sensitivity/storage, and
     repeated-error evidence.
9. **Use four explicit user actions instead of ambiguous removal**
   - **Correct** updates an inaccurate understanding and gives the user's
     correction higher authority within the relevant scope.
   - **Undo recent change** restores the state before an automatic addition,
     replacement, or removal within the seven-day window and rejects the same
     transition from unchanged evidence.
   - **Pause use** keeps the saved content but makes it inactive until the user
     restores it; it is reversible and does not alter source notes.
   - **Forget** removes the saved Memory content and source references, keeps only
     a text-free prevent-relearning marker, and is not content-recoverable from PA
     Memory state. It does not silently rewrite source notes or existing visible
     conversations; message or conversation deletion remains the explicit way to
     remove visible chat text and keep it out of later chat context.
   - Do not use a generic `Remove` label when the outcome could mean correction,
     reversible pause, recent undo, or permanent forgetting.
10. **Use unified Settings as the canonical Memory governance surface**
   - The first implementation should not add a persistent standalone Memory tab.
   - Settings should provide the complete low-frequency control center through
     summary cards and progressive detail, not a long flat list of toggles.
   - Chat, Pagelet, and Recall should still provide in-context source explanation,
     correction, and deep links to the relevant Settings detail.
   - Settings may use an internal detail page or lightweight modal without
     creating a second canonical management surface.
   - Reconsider a standalone tab only if real usage shows frequent search, bulk
     editing, source comparison, or sustained Memory-management sessions.
11. **Keep personalization and Memory state device-local in the first version**
   - The thin collaboration layer may follow the user across vaults on the same
     device, but it does not automatically synchronize to another device.
   - Note-derived understanding, Confirmed Memory, Recent changes, undo snapshots,
     and prevent-relearning markers remain device-local product state.
   - Vault notes may synchronize through the user's existing Obsidian workflow,
     but synchronized notes do not imply synchronized PA Memory state.
   - Each device prepares or rebuilds its own note-derived local state under that
     device's settings and data boundary.
   - Cross-device Memory synchronization is deferred; explicit export/import may
     provide future portability without becoming automatic sync.
12. **Plan manual export/import as an advanced follow-up, not the first slice**
   - Do not add automatic cloud or cross-device synchronization.
   - Stabilize the Memory schema and lifecycle before implementing portability.
   - Export only non-reconstructable durable state: explicit collaboration
     preferences, user corrections, Confirmed Memory, and text-free
     prevent-relearning markers.
   - Exclude reconstructable or temporary state such as the local index, caches,
     note-derived retrieval state, Recent changes history, and undo snapshots.
   - Import must show a scope and category preview, validate schema/version, and
     default to merge; replace remains an explicit advanced dangerous action.
   - Export and import must disclose that the package may contain sensitive
     personal context.
13. **Keep Memory taxonomy internal and show user-relevant meaning instead**
   - Keep `preference`, `decision`, `project_context`, `task_constraint`, and
     `open_question` as internal policy, risk, validation, and migration fields.
   - Do not use those types as primary Settings navigation, list grouping, or
     ordinary user-facing chips.
   - Show the user the attributes that affect trust and correction: source,
     scope, purpose/effect, lifecycle status, and time.
   - Use natural product sections such as PA's understanding of you,
     Collaboration style, Current vault agreements, Long-term memory, Recent
     context, and Recent changes.
   - Technical type details may remain available only in advanced diagnostics
     when they materially help troubleshooting.

## Historical Problem Signal

At intake, PA's Memory experience was distributed across several surfaces:

- Settings contains Memory enablement, provider-cost consent, AI memory
  extraction, and advanced local maintenance controls;
- AI Insights exposes generated user-profile and vault-insight output;
- Pagelet contains Memory Candidates, Confirmed Memory records, trust behavior,
  and removal actions;
- Chat and Pagelet can use Memory without a single user-facing place that
  explains the whole relationship.

The user could not answer all of these questions in one place:

- How does PA currently understand me?
- Why does PA believe each important understanding?
- Which notes, conversations, or explicit instructions contributed to it?
- Where will it affect recall, answers, or future behavior?
- How do I correct, pause, remove, undo, export, or restore it?
- Which state belongs to the vault, this device, or a reconstructable local
  index?

## Product Goal

Create one coherent Memory control center that lets PA learn quietly while the
user retains on-demand understanding and control.

Success means:

- the user does not need to classify individual memories;
- low-risk learning does not produce recurring confirmation work;
- meaningful changes remain inspectable and correctable;
- note evidence and derived user understanding remain connected;
- storage and lifecycle boundaries are understandable without exposing internal
  implementation jargon;
- control is available when needed without becoming a routine maintenance task.

## Candidate Information Architecture

```text
Settings -> Memory and personalization
├── Overview
│   └── Current state, latest update, and active data boundary
├── PA's understanding of you
│   └── Current-vault understanding by default; inspect, correct, pause, or forget
├── Collaboration style
│   └── Thin explicit defaults that may follow the user across vaults
├── Current vault agreements
│   └── Vault-scoped rules, constraints, and working conventions
├── Long-term memory
│   └── Stable goals, decisions, background, and continuing threads
├── Recent context
│   └── Automatically maintained and expired; no routine user filing
├── Recent changes
│   └── On-demand audit and recovery; no unread badge or review obligation
└── Data and recovery (advanced)
    └── Device-local status, export/import, rebuild, reset, and diagnostics
```

This is the single complete governance destination; contextual correction remains
available where Memory is used. These sections are user-understandable lifecycle
and control layers. Internal
types such as `preference`, `decision`, `project_context`, or `task_constraint`
may still support policy, search, and validation, but should not require the user
to manage an ontology.

Scope should be assigned from provenance rather than through recurring user
filing: explicit durable collaboration preferences may apply across vaults on
the same device only after a direct scope action; note-derived understanding
defaults to the current vault; task context expires by default.

## What To Borrow From Qoder

1. **One control surface**
   - Memory state, understanding, maintenance, and recovery should feel like one
     system even when different stores and runtimes remain underneath.
2. **Summary first, detail on demand**
   - Show status, recency, and the next useful action before raw records or
     diagnostics.
3. **Inspectable recent changes**
   - Prefer a lightweight history with source, reason, and correction or undo
     over repeated low-risk confirmation prompts.
   - Do not turn this history into another queue, inbox, or completion metric.
4. **Visible ownership and portability**
   - Explain what is vault-owned, device-local, reconstructable, exportable, or
     synchronized.
5. **Advanced repair remains available**
   - Rebuild, reset, and import/export should exist without becoming ordinary
     Memory work.

## What Not To Copy Directly

- Do not show profile or memory capacity percentages that can be mistaken for
  understanding quality or completion.
- Do not require ordinary users to understand files such as `USER.md`,
  `MEMORY.md`, `AGENTS.md`, local caches, or vector indexes.
- Do not expose internal taxonomy as the primary navigation model.
- Do not make index rebuilds, cache cleanup, or storage maintenance part of the
  normal workflow.
- Do not treat raw Markdown visibility as sufficient explanation; important
  understanding still needs source, scope, recency, and effect.
- Do not allow imported content to silently overwrite, widen scope, or gain
  instruction or action authority.

## Candidate Delivery Plan

Current status: Phases 0-5 are complete. The post-timeout desktop confirmation,
governed Chat/AI Insights runtime checks, isolated Device A/B compatibility,
real-device iOS, final review/fix/re-review, and closeout all pass in the active tracker.

### Phase 0: Product Alignment

- Reconcile the North Star language for `understanding notes -> understanding
  the user`.
- Separate source evidence, derived understanding, explicit collaboration
  agreements, and action authority without turning them into multiple products.
- Define the top-level principle: one Memory entry point with several natural
  lifecycle and control layers.

Exit gate:

- product language is agreed before UI or storage design begins;
- no contradiction remains between the North Star and active Memory specs.

### Phase 1: Information Architecture And Spec Reconciliation

- Make Settings the canonical Memory governance surface and map contextual
  source/correction/deep-link responsibilities for Pagelet, Chat, and Recall.
- Remove the first-version assumption that a persistent standalone Memory panel
  is required.
- Reconcile:
  - `pa-product-information-architecture-spec.md`;
  - `pa-memory-type-taxonomy-product-spec.md`;
  - `pa-data-boundary-product-spec.md`;
  - `pa-retrieval-habit-profile-product-spec.md`.
- Define source, confidence, scope, temporal validity, sensitivity, effect, and
  correction semantics.
- Preserve the existing Memory types as internal policy fields while defining
  user-facing source, scope, purpose/effect, lifecycle, and time labels.
- Encode the confirmed scope defaults: thin explicit collaboration preferences
  may cross vaults, note-derived understanding does not.
- Translate the confirmed effect-based quiet-update policy into testable admission,
  disclosure, Recent changes, correction, and undo rules.
- Decide whether user understanding is a materialized record, a derived view, or
  a hybrid with source-linked claims.

Exit gate:

- one canonical Memory surface contract exists;
- overlapping stores and lifecycle responsibilities are mapped;
- unresolved product choices are explicit.

### Phase 2: Interaction Prototype And Copy

- Prototype Overview, PA's understanding of you, Recent changes, and Data and
  recovery.
- Keep Recent changes free of unread badges and pending-work semantics; validate
  that users can ignore it without future penalty.
- Prototype `Correct`, `Undo recent change`, `Pause use`, and `Forget` as distinct
  outcomes; avoid an ambiguous generic removal action.
- Test progressive disclosure for sources, scope, and why-used details.
- Prototype summary cards plus Settings-internal detail and lightweight modal
  patterns without creating a second canonical destination.
- Prototype in-context correction and deep links from Chat, Pagelet, and Recall.
- Validate that correction and pause flows feel lighter than recurring review
  queues.

Exit gate:

- users can explain what PA knows, why it knows it, and how to correct it;
- ordinary use does not create a new organization or cleanup obligation.

### Phase 3: Storage, Lifecycle, And Migration Design

- Map note evidence, derived user understanding, Confirmed Memory, recent
  context, and the local retrieval index.
- Specify invalidation when source notes change or are deleted.
- Encode the confirmed device-local first-version boundary: even the thin
  cross-vault collaboration layer does not automatically cross devices.
- Design export/import preview, schema and version validation, merge/replace,
  conflict handling, and sensitive-data warnings.
- Keep implementation of export/import outside the first runtime slice until the
  durable schema and lifecycle have stabilized.
- Use the provisional seven-day window for Recent changes and detailed undo
  snapshots while keeping text-free prevent-relearning markers source-bound
  rather than time-expiring.
- Ensure forget, pause, archive, reset, rebuild, and source deletion have
  non-overlapping meanings.

Exit gate:

- the source of truth and reconstructable state are unambiguous;
- migration and rollback are specified before runtime changes.

### Phase 4: SDD, Implementation, And Verification

- Create a formal SDD and implementation tracker.
- Implement in product slices rather than replacing all Memory infrastructure at
  once.
- Add focused tests across Memory, Settings, Pagelet, Chat, extraction, and
  migration paths.
- Run privacy/security review, provider-cost review, code review, and Obsidian
  smoke; include real-device verification when mobile surfaces change.

Exit gate:

- implementation behavior matches the approved product surface contract;
- no P0-P2 findings remain open without explicit deferral;
- smoke evidence covers the actual Memory control surface and lifecycle actions.

## Dependencies And Overlap

| Area | Relationship |
| --- | --- |
| Product North Star | Must define the intended relation between note understanding and user understanding. |
| Product Information Architecture | Its dedicated Memory-panel decision must be revised to the confirmed unified-Settings model while preserving contextual surfaces. |
| Memory Type Taxonomy | Contains useful internal policy fields but is currently type-first. |
| Data Boundary | Governs source eligibility, provider disclosure, cleanup, and export. |
| Retrieval Habit Profile | Contains scope, retention, and learning constraints that may become part of the control center. |
| Settings IA | Canonical `Memory and personalization` now combines summary, progressive detail, lifecycle, Recent changes, and recovery without creating another destination. |
| Pagelet Memory governance | Existing candidates, records, recent confirmations, and removal behavior may feed the unified surface. |
| MemoryManager / VSS | Note Memory and the device-local index must remain source/cache-correct during any UI consolidation. |

## Risks Carried Into Development

The active tracker records disposition. Runtime/test evidence has closed the
implementation risks below. Automatic cross-device governed-Memory sync remains
out of scope rather than an unfinished gate.

- Note topics may be misattributed as the user's identity, values, health,
  finances, or political views.
- A vault- or project-scoped understanding may leak into global behavior.
- A generated understanding may gain more authority than its evidence permits.
- Import may mix users or vaults, overwrite newer state, or inject instructions.
- Export may disclose sensitive profile or conversation-derived content.
- Device-local Memory may be mistaken for synced vault state.
- Transparency may become a new management queue if every change demands action.
- Existing Confirmed Memory, AI extraction, and retrieval state may have
  incompatible lifecycle or deletion behavior.

## Product Decision Status

All top-level product-intake decisions are captured. Promotion, current-code
revalidation, implementation, verification, and closeout are complete.

## Deferred Future Consideration: Cross-Vault Understanding

Do not include cross-vault synthesis in the first implementation. Reconsider it
only when there is evidence that repeated setup across multiple vaults creates a
meaningful user burden and the product can answer all of the following:

- which vaults participate and how the user opts in;
- which source evidence may cross vault boundaries;
- how conflicting or time-bound understandings remain scoped;
- what is stored locally, synchronized, exported, or sent to a provider;
- how the user inspects, corrects, disconnects, and removes cross-vault state;
- how migration and rollback avoid contaminating independent vault contexts.

## Promotion Trigger

The user selected this work for an iteration on 2026-07-10. Promotion from the
original docs-only Phase 0/1 is complete: canonical Settings and the governed
runtime now exist. The active tracker is authoritative for the completed
device/mobile/final-review evidence.

The promotion lifecycle was:

1. re-read current runtime and active specs;
2. resolve overlaps and dependencies;
3. draft the implementation SDD and tracker;
4. implement through focused slices with review and smoke gates.

## Evidence Classification

| Classification | Conclusions |
| --- | --- |
| Current project | Settings is the canonical Memory governance destination. Note Memory/VSS and derived observations retain their own source boundaries; governed durable state, lifecycle, admission/use, migration/rollback, and exact contextual routing are implemented. |
| Confirmed product decision | Only a thin explicit collaboration layer follows the user across vaults on the same device; note-derived understanding remains vault-scoped by default, and no PA Memory or personalization state automatically synchronizes across devices in the first version. Manual export/import is an advanced follow-up after schema stabilization: export only non-reconstructable durable state, exclude indexes/caches/transient history, preview and validate imports, merge by default, and treat replace as dangerous. Quiet updates are governed by effect: scoped retrieval help may be silent, low-risk durable changes require Recent changes plus correction/undo, and broad/sensitive/constraint effects require prior disclosure. Recent changes is an on-demand audit and recovery log, not a review queue or unread obligation. Its first implementation uses a provisional seven-day display and detailed-undo window, while text-free prevent-relearning markers remain source-bound instead of expiring on that timer. User actions are explicit: Correct, Undo recent change, Pause use, and Forget; generic Remove is avoided. Unified Settings is the canonical governance surface; contextual surfaces keep inline explanation/correction, and a standalone Memory tab is deferred until usage proves it necessary. Internal Memory taxonomy remains available for policy and validation, while ordinary UI shows source, scope, purpose/effect, lifecycle, and time through natural product sections. |
| Product judgment | A unified control center with natural lifecycle layers should reduce burden while improving inspectability and correction. Cross-vault understanding is a later option, not initial scope. |
| Deferred validation | Export/import package design and cross-vault understanding require separate future product decisions; they are not unfinished gates in this iteration. |
