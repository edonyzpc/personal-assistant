# PA Quiet Recall And Insight Timing Product Spec

> [!note] Current implementation includes the 2026-07-02 amendments: the
> candidate pool spans the eligible vault and triggers are note open/switch,
> save-after, and user-initiated shortcut. Current authority is this spec,
> DEC-020, and the B-108 owning Scope Recap spec; Archive links below are
> historical provenance only.

Updated: 2026-07-19

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Status | DEC-020 evaluation/limiter/cache/provenance substrate is validated, but the 2026-07-19 B-118 audit confirmed user-reachability, action/feedback, first-use provider disclosure and settings drift. Treat Off/Quiet/Balanced UI and Not relevant delivery as Planned under B-118, not currently delivered. |
| Feature family | Quiet Recall / Just-in-time insight / Cognitive scaffolding |
| Primary surfaces | Pagelet Bubble, Pagelet Panel, optional Review Queue handoff |
| Current authority | This spec, [DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md), and the [B-108 owning Scope Recap spec](./pa-scope-recap-theme-summary-product-spec.md) |
| Historical research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related current specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |
| Related Pagelet doc | [Pagelet product design](../pagelet-product-design.md) |
| Related decisions | [DEC-020 — independent Quiet Recall evaluation](../decisions/dec-020-independent-quiet-recall-evaluation.md) |
| Product doctrine | [Low-Burden Review Product Principles](../pa-low-burden-review-product-principles.md) |

This spec defines when and how PA proactively surfaces old notes, themes, and
counterexamples. The bounded quiet-recall flow is implemented; real-time
editing interruption and broader proactive behavior remain out of scope.

Quiet Recall is PA's just-in-time cognitive scaffolding layer:

> PA quietly helps the user remember relevant past thinking at the moment it
> may matter, without becoming a notification feed or an inline writing
> interruption.

This document records the one-question-at-a-time product decisions initially
confirmed on 2026-06-28 and the DEC-020/B-108 amendments through 2026-07-19.
[DEC-021](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md) and the
[B-118 Product Spec](./pagelet-ui-ux-hardening-product-spec.md) record current
action, feedback, disclosure and settings drift. B-118 may repair evidence-backed
defects, but new frequency, migration, authorization-reuse, feedback-retention or
Later semantics require the explicit stop gates recorded there.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| QR-D1 | When explicitly enabled, Quiet Recall uses Pagelet Bubble. | The feature defaults off; enabled Recall appears as low-frequency, high-signal Pagelet nudges, not editor inline interruptions or modals. |
| QR-D2 | Enabled Recall triggers after explicit context changes. | Current triggers include note open/switch, save-after, and user-initiated review; weekly scan is broader/future. All automatic triggers require cooldown and frequency limits. |
| QR-D3 | Recall content includes related notes, theme chains, and lightweight conflicts/counterexamples. | Recall surfaces clickable, verifiable lines of thought rather than black-box "AI insights." |
| QR-D4 | Ranking defaults to mixed relevance, with a small remote-association bonus. | Rank by semantic relevance, recent activity, explicit links/tags, and confirmed memories/themes; allow at most a small "far association" candidate with explanation. |
| QR-D5 | Bubble defaults to one visible item and may expose a 2-to-3-item stack only when every candidate independently passes the high quality gate and is distinct/source-backed. | The first glance stays calm; Pagelet Panel can expand to more evidence and candidates. |
| QR-D6 | Recall does not write automatically. | Users can save a recall as a link, insight, or Memory Candidate; PA does not mutate notes or Memory by default. |
| QR-D7 | Recall supports dismiss and `not relevant` feedback. | PA can learn lightweight negative signals without asking users to fill out reason forms. |
| QR-D8 | Recall has simple frequency settings: Off / Quiet / Balanced, with Off as the default. | Users opt into proactive behavior without a complex rule engine; generic Pagelet hints stay off as well. |
| QR-D9 | Bubble shows only a line and why-shown; evidence lives in Pagelet Panel. | Bubble remains a doorway; Panel provides source-backed verification. |
| QR-D10 | Recall is not a queue item by default. | Closing, ignoring, or dismissing a recall cue creates no user debt; Review Queue is used only after user-chosen save, later, promotion, or action handoff. |
| QR-D11 | Each eligible Recall candidate receives an independent AI why-now evaluation. | Local ranking may nominate at most 5 candidates per round; each candidate fails independently, receives at most one language retry, and never falls back to a template proactive nudge. |

## 1. Product Decision

When the user explicitly enables it, Quiet Recall should be proactive but not
intrusive. The default product state is off and silent.

The selected shape:

> Pagelet Bubble may surface one high-signal memory cue after meaningful
> context changes. The Bubble does not explain everything; it invites the user
> into Pagelet Panel for evidence, source cards, and actions.

This makes Quiet Recall different from:

- search, because the user did not type a query
- autocomplete, because it does not intervene inside the editor
- notification feed, because it is low-frequency and dismissible
- AI oracle, because it shows evidence and avoids unsupported conclusions
- graph browser, because it surfaces local cues, not a full vault map

## 2. Why This Matters

Personal knowledge compounds when users can rediscover old thoughts at the
right moment.

The product risk is that "proactive assistant" often becomes "always-on
interruption." In a second-brain product, this is especially dangerous:

- writing flow is fragile
- old notes can be emotionally or contextually sensitive
- apparent relevance can be wrong
- too many suggestions turn into another inbox
- black-box insights reduce trust

Quiet Recall should therefore follow a narrow promise:

> PA may softly point at useful old context, but the user decides whether it
> matters and whether it becomes part of the vault structure.

This promise includes a burden boundary:

> Recall is allowed to be noticed and then disappear.

PA should not create a Review Queue item merely because a recall candidate was
generated. Queue handoff is reserved for explicit user intent, such as `Later`,
`Save`, `Create Memory Candidate`, or a maintenance/action proposal.

## 3. Trigger Model

Quiet Recall should trigger after explicit context changes, not continuous
editor monitoring.

### 3.1 Current And Future Trigger Candidates

| Trigger | Why it matters | Default behavior |
| --- | --- | --- |
| Open note | Current context becomes clear | Eligible after debounce and cooldown |
| Save Quick Capture | A new thought enters the vault | Eligible for related-note/theme recall |
| Run Pagelet review | User is already in review mode | Eligible for richer recall and evidence |
| Weekly scan | User expects retrospective synthesis | Broader/future integration; not a current B-108 trigger or completion claim |

### 3.2 Not v1 Triggers

Do not trigger by default from:

- every keystroke
- real-time editor text scanning
- hidden continuous background monitoring
- every file modification event
- every chat token or partial response

Future SDDs may add more triggers, but each trigger must define:

- user-visible purpose
- cooldown
- daily limit interaction
- data boundary behavior
- evidence requirements
- off-switch behavior

## 4. Frequency Settings

Quiet Recall should expose simple frequency settings.

| Setting | Behavior | Intended user |
| --- | --- | --- |
| Off (default) | No proactive Bubble hints; local matches may appear only after explicit Discover and under the labeling boundary below. | Users who do not want proactive behavior |
| Quiet | Very low frequency; only strongest signals appear. | Users who are sensitive to interruption |
| Balanced | Opt-in bounded daily and per-context nudges. | Users who want useful recall without noise |

Call limits are fixed by the B-108 owning contract; display-frequency tuning
must stay within these product principles:

- never show repeated nudges for the same note in a short window
- default to one visible Bubble item; expose a 2-to-3-item stack only when all
  candidates independently pass the high quality gate and remain distinct
- never use a modal
- never block editing
- allow immediate dismiss
- respect quiet hours if Pagelet has them

### 4.1 Independent Evaluation And Call Boundary

[DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md) fixes the
quality/cost tradeoff for provider-backed why-now evaluation:

- local retrieval and mixed ranking select at most 5 candidates per eligible
  evaluation round
- each candidate is sent in its own initial provider call; one candidate's
  failure or rejection does not invalidate another candidate
- only a why-now language mismatch permits one retry for that candidate
- one round therefore has a hard ceiling of 5 initial calls plus 5 language
  retries, or 10 actual provider calls
- the current 60-second cooldown limits rounds, not calls; hour/day limits must
  count actual provider calls, including retries
- Quiet Recall uses its own persisted actual-call bucket: 10 calls per rolling
  hour and 50 calls per local day. Every initial call and language retry
  reserves before invocation; failures, timeouts, malformed/rejected output,
  and wrong-language calls consume the slot
- Recap, generic preload, and foreground review have separate buckets and do
  not consume or replenish Quiet Recall capacity
- a quality judgment may be reused only for an exact context-candidate key:
  current-note identity/content, candidate identity/content, locale,
  provider/model, evaluator version, and Data Boundary snapshot must all match
- availability, cooldown, budget, timeout, and transport failures are not
  cached as quality judgments; any cache-key component change requires a new
  evaluation when the call gates permit it
- these engineering guardrails may not change independent evaluation into
  shared/batch judgment
- when provider, cooldown, or budget prevents evaluation, a local match may
  remain available only after explicit Discover and must be labeled
  `Local related clue` / `本地关联线索`; it has no AI why-now, does not use
  AI-evaluated Recall styling, never mixes into a proactive Recall stack, and
  cannot trigger a nudge

## 5. Recall Content

Quiet Recall should surface line-of-thought cues, not finished conclusions.

### 5.1 Content Types

| Type | Meaning | Example |
| --- | --- | --- |
| `related_note` | A specific older note may be relevant | "This connects to your Pagelet trust boundary note." |
| `theme_chain` | Several notes may share a recurring theme | "This looks like part of your 'quiet assistant' theme." |
| `counterexample` | An older note may challenge the current direction | "You previously worried that too much autonomy could reduce trust." |
| `tension` | Two notes may express a useful unresolved conflict | "One note favors autonomy; another favors explicit confirmation." |
| `remote_association` | A farther connection may be creatively useful | "This may connect to your flomo capture principle." |

### 5.2 Not Allowed As Default Recall

Avoid:

- unsupported "big insight" claims
- generic motivational summaries
- task creation
- automatic backlinks
- automatic Memory updates
- full graph maps
- full search result pages

Recall should say "this may be useful to inspect," not "this is the answer."

## 6. Ranking Model

Quiet Recall should use mixed ranking.

Default ranking signals:

- semantic relevance
- recent activity
- explicit links
- tags
- folder proximity
- backlinks
- aliases
- user-confirmed memories
- user-confirmed themes
- prior accepted recall suggestions
- negative feedback from dismiss / not relevant

### 6.1 Semantic Relevance Is Candidate Generation

Semantic similarity should find candidates, but should not be the final ranking
truth.

Problems with pure similarity:

- same words can mean different contexts
- old notes can appear relevant but be stale
- personal vaults mix work, life, research, and projects
- similar content can create repetitive hints

### 6.2 Remote-association Bonus

Quiet Recall may include a small remote-association bonus.

Rules:

- at most 1 remote-association candidate in Bubble
- never rank remote association above strong evidence-backed candidates by
  default
- label it clearly, for example `A farther connection`
- explain why it appears
- demote it quickly after `not relevant`

This preserves the creative value of surprising connections without letting
surprise dominate the product.

## 7. Bubble Contract

Bubble is the doorway, not the evidence view.

### 7.1 Bubble Content

Bubble should show:

- one visible recall item by default
- an optional 2-to-3-item stack only when every item independently passes the
  high quality gate, is distinct/source-backed, and creates no queue debt
- each item as one short line
- one `why-shown` sentence or compact label
- source count when useful
- actions: `View`, `Dismiss`, `Not relevant`, optionally `Later`

These rules describe AI-evaluated Recall. Explicit Discover may instead show a
local related clue when evaluation is unavailable or rejected. That clue must
use the local label, show only verifiable local relation/source facts, omit the
AI `why now`, and remain visually distinct from proactive Recall cards.

Closing the Bubble without choosing an action is a valid completion. It should
not count as an unhandled item.

Example:

```text
This note may connect to 2 older thoughts about "quiet assistants."
Why: shared tag + accepted Pagelet decision.
```

### 7.2 Bubble Should Not Show

Bubble should not show:

- long excerpts
- source card stacks
- graph visualization
- conflict diff
- full ranking explanation
- save-to-memory controls
- automatic write actions
- batch review controls

## 8. Pagelet Panel Contract

Pagelet Panel is the evidence and action surface.

When the user opens a recall item, Panel should show:

- related source notes
- source excerpts
- why-shown explanation
- ranking signals in human language
- theme chain when relevant
- counterexample or tension when relevant
- local graph context when useful and bounded
- actions to save, dismiss, or mark not relevant

### 8.1 Panel Actions

Allowed actions:

| Action | Result |
| --- | --- |
| Open source | Opens source note |
| Save as link suggestion | Creates a link proposal or accepted link action, depending on write policy |
| Save as insight | Creates a source-backed insight card or review note |
| Create Memory Candidate | Sends a source-backed candidate to Trust Layer |
| Dismiss | Removes this recall item |
| Not relevant | Records negative feedback and dismisses |
| Later | Snoozes the item and may create a Review Queue handoff |

Any action that writes to source notes must follow the relevant write boundary
and review policy.

Panel actions are optional. Opening evidence does not require the user to save,
accept, or classify the recall item.

## 9. No Automatic Writes

Quiet Recall should not mutate the vault by default.

It should not automatically:

- add backlinks
- update tags
- create graph edges
- save memories
- create tasks
- rename notes
- move notes
- append insight text

User-confirmed save actions may create:

- link proposals or confirmed links
- source-backed insight cards
- Memory Candidates
- review notes
- graph edges with kept/source-backed lifecycle state

The key product rule:

> Recall may surface a possible connection. Only the user can decide whether
> the connection becomes structure.

## 10. Feedback And Learning

Quiet Recall needs lightweight feedback.

### 10.1 Dismiss

`Dismiss` means:

- hide this item
- do not treat it as a strong negative signal
- allow similar items later if they are strong enough

### 10.2 Not Relevant

`Not relevant` means:

- hide this item
- reduce similar future suggestions
- lower the weight of similar source, topic, trigger, or remote-association
  pattern
- do not ask the user for a reason

Do not make users choose among many reason categories in v1. A single
negative-signal action is enough.

### 10.3 Accepted Or Saved

Accepted or saved recall should increase confidence for:

- similar explicit structures
- similar themes
- similar source notes
- accepted graph edges
- confirmed memories or user-approved topics

## 11. Relationship To Active Vault Indexer

Active Vault Indexer provides the substrate for recall.

Needed inputs:

- SourceRef
- RetrievalOutcome
- why-shown labels
- ranking lanes
- explicit structure signals
- activity signals
- user-confirmed memory/theme signals
- data boundary policy
- replay metadata

Quiet Recall should consume retrieval outcomes rather than building a separate
retrieval stack.

Recall output should include:

- recall item type
- sourceRefs
- trigger context
- ranking explanation
- feedback state
- replayRef when available

## 12. Relationship To Graph Discovery

Quiet Recall is one user-facing delivery channel for lightweight graph-aware
discovery.

Graph Discovery can provide:

- related notes
- theme chains
- tension pairs
- counterexamples
- remote associations
- kept/source-backed graph edges

Quiet Recall constrains how these are shown:

- Bubble defaults to one cue and exposes a 2-to-3-item stack only when every
  candidate independently passes the high-quality gate and remains distinct and
  source-backed
- Panel shows bounded evidence
- full-vault graph browsing is out of scope
- AI-inferred edges are suggestions until kept/source-backed

## 13. Relationship To Quick Capture

Quick Capture can trigger Quiet Recall after the original micronote is saved.

Examples:

- user captures a product decision
- PA quietly finds related older notes
- Bubble shows one recall cue later, with a stack only when multiple candidates
  independently clear the same high quality bar
- Panel lets user save an insight, link, or Memory Candidate

Important boundary:

> Capture saves original text first. Recall happens after capture, not before
> or during typing.

This keeps capture friction low.

## 14. Relationship To Trust Layer

Quiet Recall depends on the Trust Layer for source-backed user trust.

Trust Layer provides:

- Evidence cards
- Memory Candidate lifecycle
- Context Firewall
- source-backed Insight / Saved Insight behavior
- conflict handling
- provenance

Quiet Recall should not create Confirmed Memory directly. It may create a
Memory Candidate only after user action from Panel.

## 15. Data Boundary And Privacy

Quiet Recall must obey the shared Data Boundary System.

Required behavior:

- Off setting disables proactive recall
- excluded folders/tags are not used unless explicitly overridden
- generated notes are excluded by default according to Data Boundary policy
- provider disclosure applies if recall generation sends note content to an AI
  provider
- broad or sensitive recall should disclose included/skipped scopes
- feedback data remains local unless a future sync/export feature explicitly
  says otherwise

Provider usage should be minimized:

- local metadata and existing index should handle candidate generation when
  possible
- provider-backed synthesis should be reserved for why-shown, theme summaries,
  or counterexample explanation when needed
- provider-backed why-now follows DEC-020's per-candidate 5/10 round boundary;
  every actual call and retry must be attributable in diagnostics and cost
  accounting

## 16. Data Model Notes

Suggested recall item fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable recall item id |
| `type` | related_note, theme_chain, counterexample, tension, remote_association |
| `trigger` | note_open, quick_capture_saved, pagelet_review, weekly_scan |
| `scope` | current note, capture, selected scope, weekly scope |
| `sourceRefs` | Source-backed notes or excerpts |
| `whyShown` | Compact human-readable reason |
| `rankingSignals` | Mixed ranking signal summary |
| `isRemoteAssociation` | Whether this is the small surprise candidate |
| `status` | suggested, viewed, dismissed, not_relevant, snoozed, saved |
| `frequencyPolicy` | Off, Quiet, Balanced snapshot |
| `dataBoundarySnapshot` | Policy used when generated |
| `createdAt` | Creation time |
| `expiresAt` | Optional expiry to prevent stale hints |
| `replayRef` | Optional eval/replay trace |

Suggested feedback fields:

| Field | Meaning |
| --- | --- |
| `recallItemId` | Recall item being rated |
| `action` | dismiss, not_relevant, saved, opened_source |
| `sourceRefIds` | Sources affected by feedback |
| `trigger` | Trigger context |
| `createdAt` | Feedback timestamp |

## 17. Evaluation

Eval Harness should test Quiet Recall with synthetic vault fixtures.

Suggested cases:

| Case | Expected behavior |
| --- | --- |
| Strong related old note | Bubble surfaces one related cue with why-shown; a stack appears only when 2 to 3 distinct candidates independently pass the high quality gate |
| Similar but wrong context | Candidate is demoted by context/structure signals |
| Theme chain | Panel shows source-backed chain, not unsupported conclusion |
| Counterexample | Panel identifies a source-backed tension |
| Remote association | At most one appears and is labeled as farther connection |
| Not relevant feedback | Similar future cue is downranked |
| Off setting | No proactive Bubble hint appears |
| Excluded folder | Excluded note is not used |
| Quick Capture trigger | Recall happens after save, not before raw capture is stored |
| Five eligible candidates | Each candidate is evaluated independently; one failure does not cancel completed siblings |
| Language mismatch | Only that candidate retries once; no third call is allowed |
| Provider, cooldown, or budget unavailable | No template why-now enters proactive Recall; explicit Discover may show a clearly labeled local related clue with no AI why-now and no proactive Recall styling |

Deterministic checks:

- Bubble never exceeds 3 items
- recall items include sourceRefs
- Bubble includes why-shown but not full evidence
- Panel includes evidence
- closing or ignoring a Bubble item does not create Review Queue debt
- no vault writes occur without user action
- no Confirmed Memory is created by recall alone
- an evaluation round makes at most 5 initial calls and 5 language retries
- actual provider calls, not rounds, are reserved before invocation and counted
  against an independent 10-per-rolling-hour / 50-per-local-day budget
- failed calls and language retries consume capacity; Recap, generic preload,
  and foreground review do not share the Quiet Recall bucket
- an exact context-candidate cache hit may reuse a quality judgment; any note,
  locale, provider/model, evaluator-version, or Data Boundary change misses
- Bubble defaults to one visible card; a 2-to-3-card stack requires every card
  to pass independently and remain distinct, source-backed, and debt-free
- failure, missing provider, cooldown, and budget exhaustion never promote a
  rule-generated why-now into proactive Recall
- Discover-only local clues are explicitly labeled, contain no AI why-now, and
  never mix with or trigger proactive Recall cards

## 18. Delivery History And Broader Roadmap

Phases 0-3 describe the delivered Quiet Recall direction, including B-108's
independent evaluation and Bubble gate. Phases 4-5 are broader/future product
directions and are not B-108 completion claims.

### Delivered Phase 0: Product Contract

- Link this spec from Product IA, Active Vault Indexer, Graph Discovery, Trust
  Layer, Quick Capture, Data Boundary, and Eval Harness.
- Add `recall_suggestion` only as an optional Review Queue handoff type for
  user-chosen `Later` or save/promote flows, not for every generated recall.
- Keep editor inline recall out of v1.

### Delivered Phase 1: Passive Recall In Pagelet

- Support user-triggered recall from Pagelet Panel.
- Render related notes with why-shown and sourceRefs.
- Established the user-triggered foundation before proactive Bubble delivery.

### Delivered Phase 2: Bubble Recall Nudges

- Add note-open and Quick Capture saved triggers.
- Add cooldown and frequency settings.
- Enforce DEC-020 independent evaluation, actual-call accounting, finite
  hour/day guards, and no-template fallback.
- Show one Bubble item by default; expose a 2-to-3-item stack only when every
  item independently passes the high quality gate.
- Route evidence to Panel.

### Delivered Phase 3: Theme And Counterexample Recall

- Add theme chains.
- Add counterexample/tension items.
- Add small remote-association bonus candidate.
- Add `not relevant` feedback downranking.

### Broader/Future Phase 4: Weekly Recall

- Integrate with weekly scan.
- Surface recurring themes and unresolved tensions.
- Keep outputs reviewable and source-backed.

### Broader/Future Phase 5: Saved Recall Artifacts

- Let users save recall as links, insight cards, review notes, or Memory
  Candidates.
- Route writes through Trust Layer and Write Action Framework where relevant.
- Keep no-auto-write default.

## 19. Broader/Future Questions

These questions do not reopen the implemented B-108 defaults, triggers,
evaluation boundary, Discover-only labeling, or relationship with generic
proactive hints:

- What should the exact user-facing label be: `Recall`, `Related`, `Connections`,
  or a quieter Pagelet-native phrase?
- How long should a recall item remain eligible before expiring?
- Should `not relevant` downrank by note, theme, trigger, or all three?
- Should saved insight artifacts be Markdown notes, local records, or both?

## 20. Summary

Quiet Recall is PA's restrained way to make personal knowledge compound.

The durable contract:

- Bubble surfaces low-frequency recall cues
- ignored recall creates no user debt
- triggers follow explicit context changes
- eligible candidates receive independent AI why-now evaluation under a
  5-initial / 5-language-retry per-round ceiling
- ranking uses mixed relevance, not pure similarity
- one small remote-association candidate is allowed
- Bubble defaults to one visible item and only exposes a 2-to-3-item stack when
  every candidate independently passes the high quality gate
- Panel shows evidence and actions
- no automatic writes
- dismiss and not-relevant feedback improve future recall
- Off by default, with opt-in Quiet / Balanced modes, gives users control

This lets PA help users rediscover their own thinking without interrupting the
act of thinking.
