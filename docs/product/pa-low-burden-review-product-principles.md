# PA Low-Burden Review Product Principles

Updated: 2026-06-29

## Status

| Field | Value |
| --- | --- |
| Document type | Product doctrine / cross-surface design constraint |
| Scope | Pagelet, AI Insight, Quiet Recall, Saved Insight, Weekly Review, Maintenance Review, Memory Candidate |
| Role | Defines how PA creates review value without turning review into user workload |
| Related north star | [PA Product North Star](./pa-product-north-star.md) |
| Related specs | [Memory Control Center spec](./specs/pa-memory-control-center-product-spec.md), [Pagelet product design](./pagelet-product-design.md), [Quiet Recall and Insight Timing spec](./specs/pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./specs/pa-saved-insight-ledger-product-spec.md), [Weekly Review spec](../archive/pa-weekly-review-product-spec.md), [Pagelet Maintenance Review spec](../archive/pagelet-maintenance-review-product-spec.md) |

This document records a product constraint that cuts across Pagelet and AI
Insight:

> Review should feel like recognition, not administration.
>
> 回顾应该像“想起来了”，不是“又多了一组待处理”。

PA should not turn safety, provenance, or human control into a new inbox of AI
outputs the user must confirm, classify, clean up, or dismiss. In a personal
knowledge product, too much review is itself a product failure.

## 1. Why Pagelet And AI Insight Exist

Obsidian already gives users strong capture, linking, local ownership, and a
durable Markdown vault. The missing value is not "more generated content." The
missing value is that old thoughts do not naturally return when they are useful.

Pagelet and AI Insight exist to help the user's own thinking re-enter the
current context:

- a past note becomes visible while writing a related note
- a recurring theme is recognized without manually scanning many files
- a tension between old and new thinking is surfaced with evidence
- a useful question, decision, or opportunity can be saved when the user wants
- a maintenance issue can be proposed safely when the user explicitly enters a
  cleanup mode

The product value is compounding personal knowledge, not producing more AI
material for the user to manage.

## 2. Core Rule

> All AI artifacts are ignorable by default. Durable consequence receives
> proportionate disclosure, control, and recovery.

This replaces a weaker rule, "all AI artifacts are reviewable." Reviewability
is necessary, but it is not enough. If every artifact becomes something the user
must process, PA has created a management burden.

### 2.1 Ignorable By Default

Read-only recall, summaries, suggestions, and insight candidates may disappear
without the user taking action.

Valid outcomes:

- the user reads and closes
- the user ignores the hint
- the user dismisses without a reason
- the user opens sources and saves nothing
- the user finishes a weekly review without handling every item

These outcomes are not failures. They are part of a quiet product.

### 2.2 Consequence Boundary

Use effect, sensitivity, scope, provenance, reversibility, and authority to
decide whether a durable change may occur quietly, needs prior review, or needs
explicit authorization. Vault mutation and external action retain their
separate confirmation/authorization boundaries.

| Type | Examples | Confirmation |
| --- | --- | --- |
| Recall | old note cue, related thought, source-backed hint | no confirmation |
| Digest | weekly summary preview, theme recap, source-backed overview | no confirmation until saved |
| Save | Saved Insight, review note, Weekly Review note | light confirmation |
| Memory | Source-backed understanding affecting future answers | quiet only when low-risk, current-vault, reversible, visible in Recent changes, and correctable/undoable; otherwise prior review |
| Maintenance | rename, move, archive, link, frontmatter, content patch | preview/diff + confirmation |
| External action | send, publish, pay, API write | explicit authorization |

User friction is for consequential risk, not for every AI sentence or every
durable byte.

## 3. Review Types

PA should separate three different experiences that are too often collapsed
into one "review queue."

### 3.1 Recall

Recall means an old thought returns.

Product shape:

- read-only
- low-frequency
- evidence-backed
- close is a valid completion
- no queue item by default

Recall should feel like "this may be worth remembering," not "please process
this item."

### 3.2 Digest

Digest means PA compresses recent material into a readable surface.

Product shape:

- short and skimmable
- source-backed when it makes claims
- no item-by-item handling required
- optional save/export
- ignored content does not become debt

Weekly Review should primarily be a digest that can lead to action, not a
checklist that must be cleared.

### 3.3 Action

Action means PA proposes a durable change.

Product shape:

- explicit intent
- source evidence
- preview or diff
- confirmation appropriate to risk
- undo or recovery path when possible
- activity log

Action is where PA earns trust. It should be powerful, but it should be entered
deliberately.

## 4. Surface Contracts

### 4.1 Pagelet

Pagelet is the timing and entry surface. Its job is to bring the right thought
back with minimal ceremony.

Constraints:

- Bubble is a doorway, not an inbox.
- Bubble shows only a few items.
- Closing Bubble creates no pending debt.
- Bubble must not surface Review Queue counts for merely generated `suggested`
  items; only user-kept or snoozed items may receive a soft "later" reminder.
- Panel shows evidence and optional actions.
- Tab is for intentional deeper review.
- Pet state can indicate "something is ready" but must not demand attention.

Pagelet should never make the user feel that a quiet hint has become homework.

### 4.2 AI Insight

AI Insight is a source-backed thought object, not an output stream.

An insight is worth showing only when it has:

- identifiable source material
- a meaningful delta, repetition, tension, opportunity, or missing link
- a clear optional next choice

If an insight has no evidence, no delta, and no optional next choice, it is AI
noise and should be discarded or downgraded.

### 4.3 Quiet Recall

Quiet Recall should default to read-only memory cues.

Rules:

- Do not create Review Queue items merely because a cue was generated.
- Do not require accept/dismiss for learning to continue.
- Allow `Dismiss` and `Not relevant` as lightweight feedback, not required
  forms.
- Route durable save, Memory, or maintenance choices to the appropriate
  confirmed flow.

### 4.4 Saved Insight

Saved Insight starts only when the user saves, accepts, or explicitly promotes
an insight.

Rules:

- PA-discovered candidates may be shown ephemerally.
- PA-discovered candidates should not silently fill the Insight Ledger.
- The Review Queue is for durable proposed changes, not every candidate.
- User-saved insight is already confirmation for ledger storage.
- Promotion to Memory requires a separate Memory confirmation.

### 4.5 Weekly Review

Weekly Review is a low-frequency compounding ritual, not a forced inbox-zero
loop.

Rules:

- Start with a readable digest.
- Show top candidates first, with expand for more.
- Let section-level skip be a first-class action.
- Do not require item-by-item handling to finish.
- Do not show checkbox-style selection or disabled save actions until the user
  explicitly enters a save/selection mode.
- Only selected/saved content enters the Weekly Review note.
- Unhandled suggestions disappear, stay ephemeral, or remain only if the user
  explicitly keeps or snoozes them.

The product question is not "did the user process every candidate?" It is "did
the user leave with a clearer sense of their own recent thinking?"

### 4.6 Maintenance Review

Maintenance Review is an explicit cleanup mode, not a default weekly burden.

Rules:

- Manual or scope-invoked first.
- Category overview before note-level proposal cards.
- No queue growth from weak signals by default.
- Batch only inside an intentional scope.
- Durable mutations require preview/diff, confirmation, log, and undo/recovery.
- Long-term autonomy can reduce repeated confirmations only after scoped trust
  is earned.

### 4.7 Memory Candidate

Memory affects future PA behavior, so it remains stricter than Saved Insight.

Rules:

- PA may suggest Memory Candidates in intentional review moments.
- Source-backed, low-sensitivity, current-vault, reversible understanding may
  update quietly only after change-event and recovery support exists.
- Conflicts, sensitive inference, durable task constraints, missing provenance,
  and same-device/cross-vault scope widening require prior review or rejection.
- `ConfirmedMemoryRecord` is the canonical user-facing Memory state. Review
  Queue state is workflow and audit history, not the source of truth for
  whether a Memory currently exists.
- Every governed Memory remains inspectable and supports the lifecycle action
  whose effect is actually implemented: Correct, Undo recent change, Pause use,
  or permanent Forget.
- Recent changes is an on-demand audit/recovery log, not a replacement review
  queue, unread count, or completion obligation.
- Disabling the Memory master setting also disables automatic acceptance.
- Memory Candidates should be grouped and sparse.
- Low-value candidates should be discarded before they reach the user.

The current runtime's Level 0-2 and 30-confirmation behavior is retained only as
a versioned legacy admission policy during migration. It must not be expanded,
treated as the target product model, or used to infer per-record authority or
same-device scope. The Memory Control Center spec supersedes it for future
admission and lifecycle behavior.

## 5. Review Queue Policy

The Review Queue must stay small and consequential.

Use Review Queue for:

- a user explicitly choosing `Later`, `Keep`, or `Snooze`
- PA proposing a durable save, Memory, or maintenance action
- conflict resolution that cannot safely disappear
- high-value weekly items the user chose to carry forward

Do not use Review Queue for:

- every generated insight candidate
- every related-note recall
- every weak link suggestion
- every theme summary
- every dismissed or ignored item

The queue should represent user intent or durable consequence, not AI workload.

## 6. Copy And Interaction Language

Prefer language that makes optionality obvious:

- `You may want to revisit`
- `This may connect to`
- `Save insight`
- `Keep for later`
- `Create note`
- `Apply selected`
- `Review cleanup suggestions`

Avoid language that implies obligation:

- `Needs review`
- `Unhandled`
- `Pending`
- `Inbox zero`
- `You must confirm`
- `Action required`
- `PA found problems`

Exception: use stronger language only when a real durability or safety boundary
exists, such as source-note mutation, external action, or a Memory update that
will affect future PA behavior.

## 7. Product Review Checklist

Before adding a Pagelet, Insight, Review, Memory, or Maintenance feature, ask:

- Can the user ignore this without future penalty?
- Does this reduce more review burden than it creates?
- Is the confirmation tied to a durable consequence?
- Can low-confidence output be discarded before reaching the user?
- Does this create a new queue, badge, count, or unresolved state?
- Is the first view a digest/recognition surface or an administration surface?
- Are selected/saved/applied items clearly separated from generated candidates?
- Does the user know what will change, what will be remembered, and how to undo
  or recover?

If the answer is weak, downgrade the feature to a read-only cue, short digest,
optional save action, or do not show it.

## 8. Success Signals

Measure whether PA reduces cognitive load, not only whether it generates
accurate candidates.

Useful signals:

- user opens Pagelet and leaves without needing to process many controls
- high save/apply rate for shown candidates
- low dismiss/not-relevant rate for proactive hints
- low queue growth over time
- short time from hint to useful source opening
- low edit and undo rate for applied maintenance
- Weekly Review note contains only selected material
- users can keep capturing notes without feeling they must manage PA output

Anti-signals:

- growing Review Queue without user intent
- many candidates shown, few acted on
- repeated confirmations for read-only information
- Weekly Review completion blocked by unhandled items
- Pagelet feels like a second task manager
- users stop capturing because PA creates cleanup work

## Final Constraint

> PA should make personal knowledge feel lighter to return to. When safety
> requires confirmation, ask clearly. When no durable consequence exists, let
> the user simply notice, ignore, or move on.
