# Pagelet Maintenance Review Product Spec

Updated: 2026-06-29

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / future implementation input |
| Status | Draft decision spec |
| Primary surface | Pagelet |
| Feature family | Global Maintenance Review |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related retrieval substrate | [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md) |
| Related Pagelet docs | [Pagelet product design](./pagelet-product-design.md), [PA Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [Pagelet Trust Layer spec](./pagelet-trust-layer-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [Pagelet async result plan](./pagelet-async-result-plan.md), [Pagelet user guide](./pagelet-user-guide.md) |
| Related write boundary | [Write Action Framework SDD](./write-action-framework-sdd.md), [Write action handoff](./write-action-design-handoff.md), [Operations Agent boundary](./operations-agent-plan.md), [Operations Agent mode SDD](./operations-agent-mode-sdd.md) |
| Product doctrine | [Low-Burden Review Product Principles](./pa-low-burden-review-product-principles.md) |

This spec defines how Pagelet should grow from a quiet review surface into a
global maintenance review surface for an Obsidian vault.

It is not current shipped behavior. The current Pagelet contract still creates
independent review notes only. This spec is the separate product definition
required before Pagelet can promote source-note maintenance actions such as
rename, move, archive, link updates, frontmatter updates, content patches, or
merge proposals.

## 1. Product Decision

Maintenance should live inside Pagelet, not as a separate top-level tab.

Pagelet's future role:

> Pagelet is PA's review surface for the vault. It can review content,
> surface insights, propose durable memories, and maintain the knowledge base.

The core decision:

> Maintenance has a global home, but every action belongs to a scope.

Global Maintenance Review answers:

- Where is my vault becoming hard to maintain?
- Which notes should be renamed, moved, archived, linked, merged, or updated?
- Which proposals are ready to apply, which need review, and which should be ignored?
- What did PA change recently, and how can I undo or recover it?

It should not answer "what new cleanup homework did PA create for me this
week?" Maintenance Review exists to reduce vault upkeep burden, not to add a
second operational inbox.

Scope-bound execution answers:

- Which exact notes are affected?
- Which action types are allowed in this scope?
- What evidence supports this proposal?
- What changes will be made?
- How can the user recover the original state?

## 2. Product Principles

### 2.1 PA's First Hand Lives In The Vault

PA should not begin as an external action agent. Its first operational value is
knowledge maintenance inside the Obsidian vault:

- rename notes
- move notes
- archive notes
- add or remove links
- update frontmatter or status
- create review, index, or MOC notes
- propose content patches
- merge related or duplicate notes
- move delete candidates to a recoverable quarantine

External actions such as email, calendar, web transactions, shell commands, or
third-party writes are out of scope for this spec.

### 2.2 Scope Decides Trust, Action Type Decides Execution

Users should not configure a raw permission matrix first. They should authorize
natural scopes:

- `Clean up Inbox`
- `Review selected notes`
- `Maintain this folder`
- `Review recent notes`
- `Keep drafts safe`
- `Only suggest`

Internally, each scope maps to an action policy:

| Action type | Auto | Review | Forbidden |
| --- | --- | --- | --- |
| rename note | scope-dependent | yes | scope-dependent |
| move note | scope-dependent | yes | scope-dependent |
| archive note | scope-dependent | yes | hard-delete replacement only |
| add/remove link | scope-dependent | yes | scope-dependent |
| update frontmatter/status | scope-dependent | yes | scope-dependent |
| minor content patch | scope-dependent | yes | scope-dependent |
| major content rewrite | no by default | yes | scope-dependent |
| merge notes | no by default | yes | hard overwrite forbidden |
| delete candidate | no by default | yes | permanent delete forbidden |
| external action | no | no | yes |

Product UI should be scope-first. Engineering policy must remain action-aware.

### 2.3 Preserve Identity, Create New Meaning

The default write strategy depends on whether the proposal preserves the note's
identity or creates a new knowledge object.

| Operation | Default strategy | Required safety |
| --- | --- | --- |
| rename | edit in place | old/new title, backlink impact, undo |
| move | edit in place | old/new path, link impact, undo |
| archive | edit in place | archive path, restore action |
| add/remove link | edit in place | source/target preview, why-shown, undo |
| frontmatter/status | edit in place | field diff, reason, undo |
| minor rewrite | edit in place | text diff, meaning-preservation rationale, undo |
| major rewrite | patch first | apply in place or create new version |
| merge notes | create new note | source list, merged outline, archive-original option |
| review/index/MOC note | create new note | source list, generated scope, update policy |
| delete | archive/delete-candidate | restore path, never hard-delete by default |

Rule:

> Preserve identity = edit in place. Create new meaning = create new note.

This prevents two bad extremes:

- freezing the vault because source notes are treated as untouchable museum objects
- letting AI silently overwrite the user's original thinking

### 2.4 Ask Less By Granting Scoped Autonomy

The end state should not ask the user to confirm every action. That would make
Maintenance Review feel like a second inbox.

The product should move from review-first to scoped autonomy:

| Stage | Experience | Purpose |
| --- | --- | --- |
| V1 Review-first | PA generates proposals; user reviews and applies selected changes | Build trust and collect preference signals |
| V2 Policy-assisted | PA asks for scope-level authorization after repeated confirmed plans | Reduce repeated confirmation |
| V3 Execute-first with digest | PA applies high-confidence allowed actions inside authorized scopes and reports them | Become a real assistant |
| V4 Exception-only | User mainly reviews conflicts, low-confidence proposals, or meaning-changing edits | Long-term knowledge steward |

Rule:

> Autonomy grows from repeated confirmed plans.

PA should not begin with broad autonomy. It should earn autonomy when the user
repeatedly confirms similar proposals with low edit and undo rates.

Current boundary:

> This spec does not supersede the current Write Action Framework or Operations
> Agent boundary. V1 Maintenance Review is review-first. Any V2+ scoped
> autonomy must first update the write/action boundary with an explicit
> authorization model, allowed action types, scope confinement, preview/digest
> semantics, undo/recovery guarantees, and audit retention.

Autonomy means fewer repetitive confirmations after the user has authorized a
scope and policy. It does not mean silent arbitrary edits. Even execute-first
actions must be:

- inside an authorized scope
- limited to allowed action types
- source-backed
- recoverable or explicitly marked non-recoverable before authorization
- visible in Activity / action log
- reversible where the action type promises undo
- covered by deterministic eval before release

Until that future boundary exists, every source-note mutation remains governed
by current-turn concrete preview and confirmation.

### 2.5 Manual First, Weekly Prepared Review Second

Maintenance should be user-invoked by default and rhythm-assisted over time.

MVP trigger model:

- Manual scan is the default.
- Weekly automatic scan is opt-in.
- Weekly scan prepares a compact overview and only creates queue state for
  user-kept or durable proposals. It does not auto-apply changes.
- Execute-first behavior appears only after scope-level authorization.

Preferred user-facing language:

- `Review vault cleanup`
- `Prepare weekly maintenance review`
- `Weekly vault checkup`
- `Review cleanup suggestions weekly`

Avoid:

- `Auto organize my vault`
- `AI clean up automatically`
- wording that implies silent source-note modification

### 2.6 No Maintenance Debt By Default

Maintenance proposals are not todos. A weak signal should not become a pending
item just because PA detected it.

Product rules:

- Show category overviews before proposal cards.
- Generate note-level proposal cards only inside an intentional scope.
- Let users ignore a category without creating queue debt.
- Use `Keep`, `Later`, or `Apply selected` to create durable queue/action state.
- Let expired or low-confidence candidates disappear.
- Reserve badges, counts, and unresolved states for user-kept proposals or
  applied actions that need follow-up.

This keeps Maintenance Review from becoming an always-growing chore list.

## 3. Pagelet Information Architecture

Maintenance is global, but it should be expressed through Pagelet's existing
review mental model.

Suggested Pagelet IA:

```text
Pagelet
  Overview
  Review
    - Summary
    - Insights
    - Memory candidates
    - Maintenance
  Sources
  Activity
```

Maintenance drill-down:

```text
Global Maintenance Review
  Overview categories
    - Inbox cleanup
    - Better titles
    - Weak links
    - Stale drafts
    - Archive candidates
    - Merge candidates
  Scope batch
    - Scope: Inbox folder
    - Scope: Recent 14 days
    - Scope: Selected notes
    - Scope: Topic cluster
  Note cards
    - grouped proposals
    - diffs/previews
    - keep/edit/dismiss/snooze
  Apply selected
  Activity / undo
```

Global overview should be compact, not a wall of proposal cards:

```text
Maintenance Review

Inbox cleanup
12 notes ready
High confidence: 8
Needs confirmation: 4

Better titles
7 notes with weak titles
5 can be renamed safely

Weak links
14 notes could use links
Top clusters: PA Agent, AI memory, product ideas
```

The user drills into a category to review note-level cards.

## 4. First Scan Categories

The first Global Maintenance Review should scan six categories.

| Category | Priority | Primary value | Typical proposals |
| --- | --- | --- | --- |
| Inbox / unsorted notes | P0 | Clearest user expectation and scope | rename, move, archive, link, status, index note |
| Untitled or low-quality titles | P0 | Improves search, linking, review, and recall | rename |
| Orphan / weakly linked notes | P0/P1 | Reconnects isolated ideas to the knowledge network | link suggestions, index candidates |
| Stale drafts | P1 | Reduces open-loop clutter | mark stale, archive, next-step summary |
| Archive candidates | P1 | Keeps current workspace clean | archive, restore path |
| Merge / duplicate candidates | P1/P2 | Consolidates repeated material | create merged note, archive originals |

Broken links are useful but P1 for this product track. Obsidian and existing
plugins already cover part of that space, and it is more utility repair than
PA's unique knowledge-maintenance value.

## 5. Scope Model

Do not introduce `Project` as an MVP concept. Obsidian has no universal project
primitive, and users may organize by folder, tag, MOC note, daily note,
backlinks, search, or recent activity.

Use `Scope` instead.

Scope examples:

| Scope | Meaning | Good fit |
| --- | --- | --- |
| Inbox scope | known inbox/unsorted folder(s) | first maintenance MVP |
| Selected notes | user-selected files or search result | bounded batch review |
| Current note neighborhood | current note + backlinks/outlinks/similar notes | links, related notes, local rename |
| Folder scope | current or chosen folder | folder cleanup, index generation |
| Tag scope | notes sharing a tag | topic review, link suggestions |
| Recent activity scope | recently edited notes | weekly review, stale detection |
| Topic cluster scope | PA-detected cluster | merge candidates, index note |

Product rule:

> Project can become a saved scope later. Scope should not force users into a
> project model.

## 6. Proposal And Queue Model

Maintenance scan results must persist as a review queue. They should not be
one-off AI outputs that disappear or regenerate unpredictably.

Queue states:

| State | Meaning |
| --- | --- |
| `suggested` | PA generated the proposal |
| `accepted` | internal status for a user-kept or confirmed item that has not necessarily been applied |
| `edited` | user changed the proposal |
| `applied` | change executed successfully |
| `dismissed` | user rejected the proposal |
| `snoozed` | temporarily deferred |
| `expired` | source notes changed and proposal is stale |
| `failed` | execution failed |
| `undone` | applied change was reverted |

Each proposal should store at least:

- `proposalId`
- `proposalType`
- `targetPaths`
- `scope`
- `sourceEvidence`
- `generatedAt`
- `confidence`
- `proposedDiff` or `patch`
- `actionPlan`
- `dependencies`
- `userDecision`
- `appliedResult`
- `undoMetadata`
- `expirationCondition`

UI grouping:

- UI groups proposals by note.
- Execution stores proposals as atomic actions.
- One note card can contain multiple proposal actions.
- A batch can apply selected actions across many note cards.
- Undo can operate at batch level or single-action level.

This preserves a simple user mental model while keeping engineering rollback,
audit, and dependency ordering tractable.

## 7. Storage And Persistence

Decision:

> Queue stays local; user-visible summaries and action logs can be written to
> the vault.

Recommended persistence split:

| Data | Storage | Reason |
| --- | --- | --- |
| Maintenance queue | plugin local state / local DB | avoids polluting vault with machine state |
| accept/dismiss/snooze preference signals | plugin local state | supports learning without exposing internals |
| weekly review summary | optional vault note | user-visible, searchable, auditable |
| applied action log | optional vault note or future production audit store | supports trust and recovery |
| undo/recovery metadata | local state plus user-visible summary | enables restore without exposing raw internals |
| full hidden provider output | do not persist | privacy and drift risk |

Future multi-device behavior needs a separate review. If queue sync becomes
necessary, only a curated subset should become vault-backed state.

## 8. Execution And Write Boundary

The current Write Action Framework v1 only covers create-file. Maintenance
Review requires a future write-action expansion before implementation.

Required write capabilities:

- multi-file proposal preview
- note rename with backlink impact preview
- note move with path and link impact preview
- archive / restore action
- frontmatter/status patch
- source-note text patch with diff
- create merged note with source refs
- archive originals after merge
- link insertion/removal
- production action log
- persistent undo/recover path
- stale source hash check before apply

Execution contract:

1. A proposal must be generated from an explicit scan scope.
2. The UI must show the scope, affected notes, reason, confidence, and source evidence.
3. The user can accept, edit, dismiss, snooze, or expand diff.
4. `Apply selected` executes selected atomic actions in dependency order.
5. Every applied action records recoverable metadata.
6. No action may hard-delete source content by default.
7. External actions are forbidden in this spec.

Even in future execute-first mode, these properties remain true:

- scope must be authorized
- action type must be allowed
- content must be recoverable
- action must be logged
- uncertainty, conflict, or scope escape goes to review

## 9. Autonomy Upgrade Model

The product should not ask users to configure autonomy before they understand
PA's behavior.

Recommended flow:

```text
Manual scan
-> user keeps/edits/dismisses proposal batches
-> PA learns scope/action preferences
-> PA detects high acceptance + low edit + low undo pattern
-> PA asks for scope-level authorization
-> weekly prepared review or execute-first digest
-> exception-only review for low-confidence/conflict cases
```

Autonomy upgrade prompt example:

```text
PA has prepared Inbox cleanup 4 times.
You confirmed 31 of 35 rename/move/link suggestions and undid none.

Allow PA to handle similar Inbox cleanup automatically and show a weekly digest?
```

The user should be able to choose:

- `Keep review-first`
- `Auto-apply safe Inbox cleanup`
- `Only auto-apply rename/link`
- `Never ask for this scope`

## 10. UX Contract

### 10.1 Global Overview

The overview should answer:

- how many proposals exist
- which categories matter now
- what is high-confidence vs needs confirmation
- when the scan last ran
- whether weekly scan is enabled
- whether any previous action can be undone

### 10.2 Note Card

Default card shape:

```text
Note: 2026-06-28 random ai thoughts.md
Current: Inbox/
Suggested: Areas/PA Agent/AI Memory Design.md

Why:
This note repeatedly mentions PA Agent, memory, Obsidian, and has strong
overlap with existing notes X and Y.

Proposed changes:
[x] Rename title
[x] Move to Areas/PA Agent/
[x] Add links to 3 notes
[ ] Apply intro paragraph patch
[ ] Create merged note with "old PA memory note"

Actions:
Accept safe changes / Edit / Dismiss / Snooze / Expand diff
```

Defaults:

- reversible identity-preserving actions can be preselected when confidence is high
- meaning-changing actions should be visible but not silently applied
- permanent destructive actions are not available

### 10.3 Digest

Weekly scan digest should say what PA prepared, not imply it changed the vault:

```text
Weekly vault checkup is ready

12 inbox notes
7 better titles
14 weak-link suggestions
5 stale drafts
3 merge candidate groups

Review suggestions
```

Execute-first digest, only after explicit scope authorization:

```text
Inbox cleanup applied

Renamed 5 notes
Moved 3 notes
Added 12 links
2 uncertain merge candidates need review

View log / Undo batch / Review exceptions
```

## 11. Privacy And Provider Boundaries

Maintenance scans may need AI provider calls. The product must make this visible.

Requirements:

- Show scope before provider calls when scan is manual.
- Explain whether note text may be sent to the configured provider.
- Show cost/credit implications when available.
- Use local heuristics before LLM calls where practical, especially for:
  - inbox detection
  - title quality heuristics
  - stale draft detection
  - obvious archive candidates
  - local link graph signals
- Respect existing excluded paths, hidden/system folder rules, and Pagelet-generated note exclusion.
- Do not send `.trash`, hidden/system folders, or generated review notes unless explicitly selected.

## 12. Metrics

Product quality should be evaluated by user trust and maintenance value, not
only model accuracy.

Core metrics:

- manual scan completion rate
- proposal accept rate
- proposal edit-before-apply rate
- dismiss/snooze rate
- post-apply undo rate
- wrong-move / broken-link incident rate
- weekly scan opt-in rate
- review queue return rate
- autonomy upgrade acceptance rate
- execute-first exception rate
- time saved in inbox/folder cleanup
- user can answer "what did PA change?"

Quality gates:

- every applied action can be explained from source evidence
- every source-note change can be recovered
- dismissed proposals do not repeatedly reappear unchanged
- stale proposals expire when source notes change
- generated review/index/merged notes preserve source refs

## 13. Phased Roadmap

### Phase 0: Product Contract

Status: this document.

- Align Pagelet's future maintenance role.
- Confirm Pagelet remains the primary surface.
- Define scope/action/autonomy/queue boundaries.
- Mark current Pagelet write boundary as requiring expansion before runtime work.

### Phase 1: Manual Scan + Local Queue

- Add Global Maintenance Review entry inside Pagelet.
- Support manual scan for:
  - inbox / unsorted
  - low-quality titles
  - weak links
- Persist proposals in local queue.
- UI groups by note; execution remains proposal-level.
- No source-note writes yet unless write framework expansion is approved.

### Phase 2: Apply Selected For Low-risk Vault Actions

- Expand write framework beyond create-file.
- Support preview + apply + undo for:
  - rename
  - move
  - archive
  - add/remove links
  - frontmatter/status
- Add action log and batch undo.

### Phase 3: Weekly Prepared Review

- Add opt-in weekly scan.
- Store prepared queue locally.
- Surface digest in Pagelet.
- Write optional weekly summary/action log note when user chooses.

### Phase 4: Content Patch And Merge Proposals

- Support minor content patch with diff and undo.
- Support major rewrite as patch or new version.
- Support merge by creating a new merged note with source refs.
- Archive originals only after user authorization.

### Phase 5: Scoped Autonomy

- Learn repeated confirmed plans.
- Prompt scope-level autonomy upgrades.
- Execute high-confidence allowed actions inside authorized scopes.
- Show digest and exception review.

## 14. Open Questions

- Should the local queue live in existing plugin data storage or a dedicated local DB?
- What is the first implementation-ready write action after create-file: rename, move, or link insertion?
- Should action logs be written into `.pagelet/` or a separate user-visible folder?
- How should Pagelet expose weekly maintenance without making the Pet feel noisy?
- How should multi-device conflicts work if one device has local queue state and another edits the same notes?
- Should user-corrected proposals feed Memory, local preferences, or only per-scope policy?

## 15. Non-goals

- No external actions.
- No hard delete by default.
- No whole-vault auto-organization by default.
- No Project abstraction in MVP.
- No hidden full provider-output persistence.
- No source-note writes before the write framework boundary is explicitly expanded.
- No user-facing action-type permission matrix in the default UX.

## 16. Summary

Pagelet Maintenance Review should make PA useful as a long-term knowledge
operator without turning it into an unsafe autonomous agent.

The intended product shape is:

- global Pagelet entry
- scope-bound proposals
- note-grouped review UI
- atomic action execution
- local persistent queue
- manual scan by default
- weekly prepared review by opt-in
- action log and undo for every write
- autonomy earned from repeated confirmed plans

This gives PA "hands" while preserving the user's ownership of the vault.
