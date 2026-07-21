# PA Quiet Recall And Insight Timing Product Spec

Document status: Current
Updated: 2026-07-21
Work item: B-108
Scoped work item: B-118
Decision: [DEC-020 — independent Quiet Recall evaluation](../decisions/dec-020-independent-quiet-recall-evaluation.md)
Scoped decisions: [DEC-021](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)、[DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md)、[DEC-024](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)
Authority: Quiet Recall 的候选、触发、质量、成本、数据、交付、反馈与无自动写入边界。

> [!note] Current implementation includes the 2026-07-02 amendments: the
> candidate pool spans the eligible vault and triggers are note open/switch,
> save-after, and user-initiated shortcut. Current authority is this spec,
> DEC-020, the B-108 owning Scope Recap spec, and the B-118/DEC-023/DEC-024 amendments;
> Archive links below are historical provenance only.

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Delivery / validation status | DEC-020 evaluation/limiter/cache/provenance substrate is validated. B-118 completed and validated Off/On、View/Later/Dismiss、DEC-023/DEC-024 actual-call admission、pure-semantic retrieval and source freshness through automated/review and authorized current-surface gates. Real provider/high-risk calls were not rerun for B-118. |
| Feature family | Quiet Recall / Just-in-time insight / Cognitive scaffolding |
| Primary surfaces | Pagelet Bubble, Pagelet Panel, optional Review Queue handoff |
| Current authority | This spec, [DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md), [DEC-021](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md), [DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md), [DEC-024](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md), the [B-108 owning Scope Recap spec](./pa-scope-recap-theme-summary-product-spec.md), and the [B-118 Product Spec](./pagelet-ui-ux-hardening-product-spec.md) |
| Historical research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related current specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |
| Related Pagelet doc | [Pagelet product design](../pagelet-product-design.md) |
| Related decisions | [DEC-020 — independent Quiet Recall evaluation](../decisions/dec-020-independent-quiet-recall-evaluation.md), [DEC-021 — evidence-led Pagelet UI/UX hardening](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md), [DEC-023 — shared Pagelet provider first-use](../decisions/dec-023-shared-pagelet-provider-first-use.md), [DEC-024 — cold semantic retrieval budget](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md) |
| Product doctrine | [Low-Burden Review Product Principles](../pa-low-burden-review-product-principles.md) |

This spec defines when and how PA proactively surfaces old notes, themes, and
counterexamples. The bounded quiet-recall flow is implemented; real-time
editing interruption and broader proactive behavior remain out of scope.

Quiet Recall is PA's just-in-time cognitive scaffolding layer:

> PA quietly helps the user remember relevant past thinking at the moment it
> may matter, without becoming a notification feed or an inline writing
> interruption.

This document records the one-question-at-a-time product decisions initially
confirmed on 2026-06-28 and the DEC-020/B-108/B-118 amendments through 2026-07-21.
[DEC-021](../decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md) and the
[B-118 Product Spec](./pagelet-ui-ux-hardening-product-spec.md) record current
action, feedback, disclosure and settings semantics. DEC-023 is the current
provider first-use authority and does not grant write, Memory, or external-action
permission. DEC-024 preserves pure-semantic candidates by treating a cold query
embedding as one disclosed, budgeted Quiet Recall provider call.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| QR-D1 | When explicitly enabled, Quiet Recall uses Pagelet Bubble. | The feature defaults off; enabled Recall appears as low-frequency, high-signal Pagelet nudges, not editor inline interruptions or modals. |
| QR-D2 | Enabled Recall triggers after explicit context changes. | Current triggers include note open/switch, save-after, and user-initiated review; weekly scan is broader/future. Automatic delivery remains gated by quality, quiet hours, Focus Mode, per-candidate-once suppression, cooldown, and provider-call budgets. |
| QR-D3 | Recall content includes related notes, theme chains, and lightweight conflicts/counterexamples. | Recall surfaces clickable, verifiable lines of thought rather than black-box "AI insights." |
| QR-D4 | Ranking defaults to mixed relevance, with a small remote-association bonus. | Rank by semantic relevance, recent activity, explicit links/tags, and confirmed memories/themes; allow at most a small "far association" candidate with explanation. |
| QR-D5 | Bubble defaults to one visible item and may expose a 2-to-3-item stack only when every candidate independently passes the high quality gate and is distinct/source-backed. | The first glance stays calm; Pagelet Panel can expand to more evidence and candidates. |
| QR-D6 | Recall does not write automatically. | Users can save a recall as a link, insight, or Memory Candidate; PA does not mutate notes or Memory by default. |
| QR-D7 | Bubble uses one lightweight `Dismiss` action. | Dismiss closes the current candidate and, only when Retrieval Habit Profile is enabled, forms a weak signal for that exact candidate; passive close/ignore is neutral. |
| QR-D8 | Quiet Recall has one Off/On setting, with Off as the default. | No display/context frequency tier or cap is exposed. Quiet Recall, generic hints, and Recap remain independently controlled. |
| QR-D9 | Bubble shows only a line and why-shown; `View` navigates to or expands current evidence without rerunning the provider. | Recall detail lives in Tab; explicit Discover continues into Panel. |
| QR-D10 | Recall is not a queue item by default. | Closing, ignoring, or dismissing creates no queue item. Only user-chosen `Later` expresses return intent and enters the existing Review Queue; Link/Save remain in Tab. |
| QR-D11 | Each eligible Recall candidate receives an independent AI why-now evaluation. | Local ranking may nominate at most 5 candidates per round; each candidate fails independently, receives at most one language retry, and never falls back to a template proactive nudge. |
| QR-D12 | Pure-semantic candidate discovery is retained; a cold query embedding is one real Quiet Recall provider call. | It passes DEC-023 admission and consumes the existing 10/hour、50/day bucket without increasing it. Empty retrieval makes no downstream evaluator/generation call; metadata-only fallback is explicit-Discover-only and never proactive Recall. |

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
generated. In Bubble, only `Later` creates the existing Review Queue handoff as
explicit return intent. Link/Save and other durable actions remain in Recall
Detail Tab and keep their existing write/confirmation boundaries.

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
- provider-call budget interaction
- data boundary behavior
- evidence requirements
- off-switch behavior

## 4. Quiet Recall Setting And Quietness Gates

Quiet Recall exposes one independent Off/On setting.

| Setting | Behavior |
| --- | --- |
| Off (default) | No proactive Quiet Recall delivery. Explicit Discover remains available and routes to Panel. |
| On | A candidate may surface only after the existing quality, quiet-hours, Focus Mode, per-candidate-once, cooldown, and provider-call gates pass. |

Migration is fail-closed: legacy `bubbleNudgesEnabled=true` maps to On; false,
missing, or any other legacy value maps to Off. Quiet Recall does not inherit or
change generic proactive hints or Scope Recap preparation/hints.

There is no separate display/context frequency tier or cap. Quietness remains a
consequence of these product gates:

- never show repeated nudges for the same note in a short window
- default to one visible Bubble item; expose a 2-to-3-item stack only when all
  candidates independently pass the high quality gate and remain distinct
- standard bounded first use follows DEC-023's shared non-blocking notice; only
  its high-risk paths may require per-use confirmation before call/cost
- standard proactive delivery never blocks editing
- allow immediate dismiss
- respect quiet hours and Focus Mode
- show each candidate proactively at most once

### 4.1 Independent Evaluation And Call Boundary

[DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md) fixes the
quality/cost tradeoff for provider-backed why-now evaluation:

- when the Memory/VSS index is ready, semantic retrieval may generate at most
  one cold query embedding through the configured provider, then execute vector
  search and mixed ranking locally; an exact valid embedding cache hit skips the
  provider call
- the cold query embedding must pass capability/provider/Data Boundary,
  eligible source/query, index-ready, cooldown, actual-call budget and
  source/current-run revalidation before DEC-023 shared first-use admission at
  the invocation seam
- local retrieval and mixed ranking select at most 5 candidates per eligible
  evaluation round
- each candidate is sent in its own initial provider call; one candidate's
  failure or rejection does not invalidate another candidate
- only a why-now language mismatch permits one retry for that candidate
- the evaluator stage has a hard ceiling of 5 initial calls plus 5 language
  retries; the cold retrieval call is separate but receives no additional
  quota and therefore reduces evaluator capacity when the same 10/hour bucket
  would otherwise be exhausted
- the current 60-second cooldown limits rounds, not calls; hour/day limits must
  count actual provider calls, including retries
- Quiet Recall uses one persisted total actual-call bucket: 10 calls per rolling
  hour and 50 calls per local day. Every cold query embedding, initial evaluator
  call and language retry commits its slot at the imminent invocation seam after
  applicable DEC-023 admission; high-risk `Run` precedes that commit. Failures, timeouts,
  malformed/rejected output, and wrong-language calls consume the slot
- Recap, generic preload, and foreground review have separate buckets and do
  not consume or replenish Quiet Recall capacity
- a quality judgment may be reused only for an exact context-candidate key:
  current-note identity/content, candidate identity/content, locale,
  provider/model, evaluator version, and Data Boundary snapshot must all match
- availability, cooldown, budget, timeout, and transport failures are not
  cached as quality judgments; any cache-key component change requires a new
  evaluation when the call gates permit it
- if cold semantic retrieval returns no candidates, downstream evaluator and
  generation calls are 0; the embedding attempt remains counted and, if it was
  the first actual Pagelet call, the DEC-023 first-use state remains notified
- no eligible source/query, index not ready, capability/provider/Data Boundary
  rejection, cooldown/budget rejection before cold-retrieval admission, or
  pre-invocation source/current-run invalidation remains a strict zero-call path
- these engineering guardrails may not change independent evaluation into
  shared/batch judgment
- when evaluator availability, cooldown, or remaining budget prevents why-now
  evaluation after a valid semantic candidate already exists, that local match
  may remain available only after explicit Discover and must be labeled
  `Local related clue` / `本地关联线索`; it has no AI why-now, does not use
  AI-evaluated Recall styling, never mixes into a proactive Recall stack, and
  cannot trigger a nudge
- when the index is unavailable, metadata relations may use the same explicit-
  Discover local-clue surface, but cannot claim semantic relevance

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
- candidate-specific weak Dismiss feedback, only when Retrieval Habit Profile is enabled

### 6.1 Semantic Relevance Is Candidate Generation

Semantic similarity should find candidates, but should not be the final ranking
truth.

Pure-semantic discovery is a required candidate lane, not a metadata alias.
When the local Memory/VSS index is ready, a cold current-note query may require
one provider-backed embedding before the vector search runs locally. That call
follows DEC-024 and the existing Quiet Recall 10/hour、50/day total budget.
Metadata such as tags, links, path and time can contribute mixed ranking, but an
index-unavailable metadata-only result is only an explicit-Discover local clue;
it cannot enter proactive Recall or be labeled semantically related.

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
- when explicitly dismissed, apply only the enabled-RHP weak signal for that
  exact candidate

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
- actions: `View`, `Later`, `Dismiss`

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

## 8. Pagelet Panel And Recall Detail Tab Contract

`View` opens or expands the current candidates in Recall Detail Tab and does not
rerun provider-backed Recall (`provider rerun = 0`). Explicit Discover continues
to route into Panel. Panel and Tab are evidence surfaces; Link/Save are Tab-only.

The applicable detail surface should show:

- related source notes
- source excerpts
- why-shown explanation
- ranking signals in human language
- theme chain when relevant
- counterexample or tension when relevant
- local graph context when useful and bounded
- actions appropriate to that surface

### 8.1 Actions By Surface

Allowed actions:

| Surface | Action | Result |
| --- | --- | --- |
| Bubble | View | Navigates to/expands current candidates in Tab; provider rerun is 0 |
| Bubble | Later | Creates one item in the existing Review Queue as explicit return intent |
| Bubble | Dismiss | Closes this candidate; optional RHP signal is weak and candidate-specific |
| Panel / Tab | Open source | Opens source note |
| Tab only | Link / Save / Create Memory Candidate | Uses the existing source-backed durable-action and write-confirmation contract |

Any action that writes to source notes must follow the relevant write boundary
and review policy.

Detail actions are optional. Opening evidence does not require the user to save,
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
- only when Retrieval Habit Profile is enabled, record a weak signal for this
  exact candidate/sourceRefs
- do not downrank similar sources, topics, or candidates
- when Retrieval Habit Profile is off, write no feedback and affect no ranking

### 10.2 Passive Close Or Ignore

Closing with X/Escape/outside click, or simply ignoring the card, is neutral:

- no feedback
- no Review Queue item
- no dismiss state

### 10.3 Later

`Later` closes the Bubble and creates one item in the existing Review Queue. It
is explicit return intent, not a fixed snooze and not an automatic queue item.

### 10.4 Accepted Or Saved

When RHP is explicitly enabled, accepted or saved recall may increase confidence
for:

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
- Recall Detail Tab lets the user save an insight, link, or Memory Candidate

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
- DEC-023's shared non-blocking notice appears only before the first actual
  standard-bounded Pagelet provider call; no-call/local-only paths do not consume it
- a cold Quiet Recall query embedding is an actual Pagelet provider call and
  passes that shared admission only after capability/provider/Data Boundary,
  source/query, index, cooldown, budget and source/current-run checks
- broad/sensitive/costly/whole-vault runs and excluded-scope overrides keep
  per-use confirmation before provider call or cost reservation
- provider trust does not grant Memory admission, vault write, Markdown, or
  external-action permission
- feedback data remains local unless a future sync/export feature explicitly
  says otherwise

Provider usage should be minimized:

- the existing index performs semantic search locally, but a cold query
  embedding may call the configured provider under DEC-024; an exact valid
  embedding cache hit should avoid that call
- metadata may supplement mixed ranking, but index-unavailable metadata-only
  matching is limited to explicit Discover local clues and cannot stand in for
  semantic candidate generation
- provider-backed synthesis should be reserved for why-shown, theme summaries,
  or counterexample explanation when needed
- provider-backed why-now follows DEC-020's per-candidate 5/10 evaluator-stage
  boundary; cold query embedding, every evaluator call and retry must be
  attributable in diagnostics and share the same 10/hour、50/day total budget

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
| `status` | suggested, viewed, dismissed, later_queued, saved |
| `quietRecallMode` | Off or On snapshot |
| `dataBoundarySnapshot` | Policy used when generated |
| `createdAt` | Creation time |
| `expiresAt` | Optional expiry to prevent stale hints |
| `replayRef` | Optional eval/replay trace |

Suggested feedback fields:

| Field | Meaning |
| --- | --- |
| `recallItemId` | Recall item being rated |
| `action` | dismiss, later, saved, opened_source |
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
| Dismiss feedback | With RHP on, only the exact candidate receives a weak signal; with RHP off, feedback/ranking effects are zero |
| Off setting | No proactive Bubble hint appears |
| On setting | Delivery still requires quality, quiet-hours, Focus Mode, per-candidate-once, cooldown, and provider-call gates |
| Excluded folder | Excluded note is not used |
| Quick Capture trigger | Recall happens after save, not before raw capture is stored |
| Five eligible candidates | Each candidate is evaluated independently; one failure does not cancel completed siblings |
| Language mismatch | Only that candidate retries once; no third call is allowed |
| Provider, cooldown, or budget unavailable | No template why-now enters proactive Recall; explicit Discover may show a clearly labeled local related clue with no AI why-now and no proactive Recall styling |
| Pure-semantic note with no tag/link/path overlap | With index ready and all gates admitted, one cold query embedding may find it; the candidate still requires independent why-now evaluation before proactive delivery |
| Cold semantic retrieval returns empty | Query embedding call is counted and may complete shared first-use; evaluator/generation calls remain 0 |
| Semantic candidates found but evaluator has no remaining capacity | Retrieval call remains counted; explicit Discover may show a local related clue without AI why-now, but proactive Recall remains silent |
| Index unavailable | No query embedding call; metadata-only relation may appear only as explicit-Discover `Local related clue`, never semantic/proactive Recall |
| Source changes before embedding/evaluator invocation or before result use | Pre-invocation drift makes the path zero-call; post-call drift discards the stale result and creates no Recall/nudge |

Deterministic checks:

- Bubble never exceeds 3 items
- recall items include sourceRefs
- Bubble includes why-shown but not full evidence
- Panel includes evidence
- View uses current candidates and adds zero provider calls
- Later creates one existing Review Queue item as explicit return intent
- Dismiss closes only the exact candidate; RHP off means zero feedback/ranking effect
- passive close or ignore creates no feedback, dismiss state, or Review Queue item
- legacy true maps to On; false, missing, and other values map to Off
- Quiet Recall, generic hints, and Recap settings remain independent
- explicit Discover continues into Panel; B-118 does not redesign the ordinary
  quiet Bubble empty state
- no vault writes occur without user action
- no Confirmed Memory is created by recall alone
- an evaluator stage makes at most 5 initial calls and 5 language retries
- actual provider calls, not rounds, are reserved before invocation and counted
  against one independent 10-per-rolling-hour / 50-per-local-day Quiet Recall
  budget; cold query embeddings, initial evaluators and retries all consume it
- failed calls and language retries consume capacity; Recap, generic preload,
  and foreground review do not share the Quiet Recall bucket
- cold retrieval with zero candidates performs exactly one embedding attempt
  when uncached and admitted, then zero evaluator/generation calls; all
  pre-embedding no-source/query/index/provider/policy/cooldown/budget paths make
  zero calls and leave first-use state untouched
- an index-unavailable metadata fallback is explicit-Discover-only, local,
  non-semantic and unable to trigger Recall/nudge
- source/current-run identity is revalidated at every provider seam and before
  use; stale results never become candidates or visible delivery
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
- Add the default-Off Off/On setting; noise remains controlled by product gates,
  not display/context frequency tiers.
- Enforce DEC-020 independent evaluation, actual-call accounting, finite
  hour/day guards, and no-template fallback.
- Show one Bubble item by default; expose a 2-to-3-item stack only when every
  item independently passes the high quality gate.
- Route evidence to Panel.

### Delivered Phase 3: Theme And Counterexample Recall

- Add theme chains.
- Add counterexample/tension items.
- Add small remote-association bonus candidate.
- Add candidate-specific weak Dismiss feedback when RHP is enabled.

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
evaluation boundary, Discover-only labeling, the B-118 Off/On and action
semantics, or the independence from generic proactive hints and Recap:

- How long should a recall item remain eligible before expiring?
- Should saved insight artifacts be Markdown notes, local records, or both?

## 20. Summary

Quiet Recall is PA's restrained way to make personal knowledge compound.

The durable contract:

- Bubble surfaces low-frequency recall cues
- ignored recall creates no user debt
- triggers follow explicit context changes
- eligible candidates receive independent AI why-now evaluation under a
  5-initial / 5-language-retry per-round ceiling
- pure-semantic retrieval is retained; a cold query embedding is one real call
  in the unchanged 10/hour、50/day Quiet Recall budget, and an empty retrieval
  makes no downstream evaluator/generation call
- ranking uses mixed relevance, not pure similarity
- one small remote-association candidate is allowed
- Bubble defaults to one visible item and only exposes a 2-to-3-item stack when
  every candidate independently passes the high quality gate
- Panel shows evidence and actions
- no automatic writes
- Bubble actions are View / Later / Dismiss; View reruns no provider, Later enters
  the existing Review Queue, and Dismiss is candidate-specific and weak only when RHP is on
- passive close/ignore is neutral; Link/Save remain Tab-only
- Off by default, with one opt-in On mode independent from generic hints and Recap
- metadata-only fallback is limited to explicit Discover and never impersonates
  semantic or proactive Recall

This lets PA help users rediscover their own thinking without interrupting the
act of thinking.
