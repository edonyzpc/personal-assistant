# PA Scope Recap And Theme Summary Product Spec

Document status: Current
Updated: 2026-07-21
Work item: B-108
Decision: [DEC-017 — default bounded background preparation](../decisions/dec-017-default-background-recap-preparation.md)
Authority: Scope Recap 及其 B-108 dogfood follow-up 的用户行为、Quiet Recall 支撑边界、范围、非目标与验收标准。

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Delivery status | B-108 shipped to BRAT `2.9.0-beta.2` with its recorded validation. DEC-023 resolves the provider first-use product contract, but B-118 runtime reconciliation remains open for fresh-install preparation and shared actual-call notice coverage; final current-surface desktop/iPhone smoke and stable release remain pending. |
| Related decisions | [DEC-018 — quality-gated proactive hints](../decisions/dec-018-quality-gated-scope-recap-hints.md), [DEC-019 — honest layered failure fallback](../decisions/dec-019-honest-layered-recap-fallback.md), [DEC-020 — independent Quiet Recall evaluation](../decisions/dec-020-independent-quiet-recall-evaluation.md), [DEC-023 — shared Pagelet provider first-use](../decisions/dec-023-shared-pagelet-provider-first-use.md) |
| Archived delivery package | [B-108 Pagelet dogfood follow-up](../../archive/2026/pagelet-b108-dogfood-followup/README.md) |
| Feature family | Scope Recap / Theme Summary / Derived map |
| Current B-108 surfaces | Pagelet Bubble, Pagelet Panel, Pagelet Tab |
| Broader/future integrations | Weekly Review, saved scopes, Markdown export targets, and broader Chat use; none is a B-108 completion claim |
| Historical research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related current specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [PA Data Boundary spec](./pa-data-boundary-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |

This spec defines how PA summarizes a user-selected scope without assuming that
the vault has a formal Project model. The base source-backed M12 flow,
prepared-delivery substrate, and the B-108/DEC-017/DEC-018/DEC-019 Recap delta
are implemented. Automated gates, repo-local deployment, bounded unlocked
desktop evidence, iPhone 15 real-device evidence, and provider-free real
Obsidian Review/Discover downstream routing/presentation and user-operated
desktop/iPhone physical long-press pass. The correctly prepared user-owned 3-Second Value Test also passed: an honest statement of the test vault's limited evidence increased trust and future-open intent. The
provider-backed Review/Discover semantic smoke and the separate optional Scope
Recap real-provider token smoke passed after explicit bounded data-transfer and
cost authorization. These behaviors were shipped through the `2.9.0-beta.2`
BRAT prerelease, not the stable Obsidian community channel. The newer
[B-118 hardening contract](./pagelet-ui-ux-hardening-product-spec.md) and tracker
record the first-screen work, the open DEC-023 provider-boundary runtime
reconciliation, and the remaining real current-surface smoke. Recap remains
derived, not source truth.

The product definition:

> Recap is a derived map, not the ground.

Recap and Theme Summary can help users review a scope, discover themes, notice
tensions, and prepare next review actions. They must not replace source notes,
act as facts by themselves, or silently become Markdown.

This document records the one-question-at-a-time product decisions initially
confirmed on 2026-06-28, the B-108 follow-up decisions, and the DEC-023
first-use amendment confirmed through 2026-07-21.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| REC-D1 | Recap scope is user-selected, not Project-assumed. | Supported scopes include current note, selected notes, folder, tag, time range, query/search result, and future saved scope. |
| REC-D2 | Generation is on-demand plus default-on, bounded background preparation for current/high-intent scopes after provider setup, with DEC-023 shared first-use notification and persistent capability opt-out. | PA prepares valuable Recap content before the user asks, while avoiding continuous whole-vault summarization and preserving broad/sensitive/costly confirmation. |
| REC-D3 | Recap is stored as a local derived object; user confirmation is required for Markdown. | Summaries are reusable without polluting the vault. |
| REC-D4 | Important claims/themes require sourceRefs, and the whole recap shows source coverage. | Recap remains readable while keeping core claims verifiable. |
| REC-D5 | Output includes summary, themes, tensions, open questions, and next review actions. | Recap is review-oriented, not just a generic summary. |
| REC-D6 | Recap weakly influences retrieval/ranking. | It can act as theme/scope signal but cannot replace source evidence. |
| REC-D7 | Recap uses source-aware stale policy. | Source changes, coverage decline, boundary changes, TTL expiry, or user distrust mark recap stale. |
| REC-D8 | Recap shows lightweight uncertainty. | Coverage, skipped sources, stale badge, low-evidence label, and generatedAt are visible without debug jargon. |
| REC-D9 | User-confirmed recap can be written to Markdown with sourceRefs and generatedAt. | Markdown is a deliberate artifact, not automatic summary drift. |
| REC-D10 | Prepared Recap proactively signals only when a new, fresh, source-backed cross-note insight passes the quality gate. | High-value content becomes discoverable without turning preparation completion into notification noise. |
| REC-D11 | Failed/empty/rejected preparation uses an honest layered fallback. | Keep any still-valid artifact; otherwise explicit open shows only local scope/source orientation plus Retry, never a rule-generated insight. |

## 1. Product Decision

Scope Recap should not require a Project concept.

Selected shape:

> PA summarizes the scope the user is actually working with, not the scope PA
> wishes the vault had.

Supported scope types:

- current note
- selected notes
- folder
- tag
- time range
- search/query result
- future saved scope

This respects Obsidian reality: some users organize by folders, some by tags,
some by links, some by Daily Notes, some by search, and many by inconsistent
mixtures of all of them.

## 2. Why This Matters

RAPTOR, GraphRAG, and theme-summary techniques are useful, but dangerous if
treated as source-of-truth memory.

Risks:

- summary drift
- stale conclusions
- second-hand facts replacing source evidence
- whole-vault background cost
- accidental privacy leakage
- false sense that PA understands a "project" the user never defined

Therefore Scope Recap should be:

- scoped
- source-backed
- stale-aware
- user-invoked or high-intent prepared
- weak influence only
- review-oriented

## 3. Generation Policy

Recap generation combines on-demand generation with default-on, bounded
background preparation. Background preparation is the instant-value path, not
permission for continuous vault summarization.

### 3.1 On-demand

On-demand generation is allowed when the user asks for:

- summarize this note
- recap these selected notes
- summarize this folder
- recap this tag
- what happened in the last 7 days
- summarize these search results
- prepare a review for this scope

### 3.2 Prepared Scopes

The implemented B-108 preparation scope is limited to:

- the current working context when relevant sources changed
- user-triggered Pagelet review scopes
- manually requested refresh

Weekly Review and user-saved-scope preparation are broader/future integrations.
They require their own current product/implementation authority and are not part
of B-108 completion.

Do not continuously summarize:

- the entire vault
- every folder
- every tag
- every note save
- every graph community

Prepared recap must at least be ready for immediate display when the user opens
the relevant Pagelet/Recap surface. Under DEC-018, only a new high-quality,
source-backed cross-note insight may also produce a light Pet signal.
Preparation itself must not open a modal, steal focus, create a task, or write
Markdown.

### 3.3 Default, Disclosure, And User Control

This policy governs the prepared Scope Recap scheduler. It does not implicitly
enable generic Pagelet review preload, even if both paths later share internal
scheduling infrastructure.

- B-108/REQ-01: After Pagelet and an AI provider are configured, bounded Scope
  Recap background preparation is on by default unless the user has disabled it.
  Before the first actual Pagelet provider call, PA shows the shared DEC-023
  non-blocking notification with provider, data-sending, possible cost, and the
  Settings opt-out; the eligible run then continues. Broad/sensitive/costly/
  whole-vault/excluded-override runs still require blocking per-run
  `run / adjust / cancel` before any provider call or cost reservation. If the
  first actual Pagelet call is such a high-risk run, a complete blocking
  disclosure counts as the shared first-use notice only after affirmative
  `Run`, immediately before invocation; it does not stack another notice.
  Cancel/close or an Adjust that has not reached an eligible run leaves the
  shared flag unchanged.
- B-108/REQ-02: A user who disables background preparation remains opted out
  across reload and upgrade; PA must not issue background Recap provider calls.
- B-108/REQ-03: Background preparation requires a changed, current/high-intent
  scope plus available budget. It must not continuously summarize the whole
  vault, every folder, every tag, or every note save.
- B-108/REQ-04: A fresh prepared artifact must provide actual source-backed
  recap items immediately on open. Empty, failed, stale, or low-value generation
  must not masquerade as a ready Recap.
- B-108/REQ-05: Background provider activity, data scope, cost usage, last-run
  status, disable control, and derived-cache clearing must be inspectable without
  exposing internal AI jargon in the ordinary Pagelet surface.
- B-108/REQ-06: Generic Pagelet review preload and prepared Scope Recap must not
  present two ambiguous `preload` controls. Scope Recap preparation has one
  coherent user-facing setting and persisted opt-out, regardless of internal
  engine reuse.
- B-108/REQ-07: Prepared Scope Recap provider calls and cost must be separately
  attributable and bounded, even when runtime infrastructure is shared with
  generic preload. Recap uses its own call bucket with a hard limit of 2 actual
  calls per rolling hour and 10 actual calls per local day; a permitted call
  reserves its slot before provider invocation, and failed calls count.

### 3.4 Quality-Gated Proactive Return

- B-108/REQ-08: High-value Scope Recap hints are on by default when bounded
  preparation is enabled under DEC-023 and can be disabled without disabling
  background preparation or click-to-view.
- B-108/REQ-09: A proactive Recap hint requires at least one actual structured
  insight with a concrete why-it-matters relationship and sourceRefs to at least
  two distinct notes. Scope summary, coverage, tags/counts, and ready-state copy
  alone never qualify.
- B-108/REQ-10: The artifact must be fresh, match the current scope, pass Data
  Boundary and coverage gates, and not be failed, empty, low-value, previously
  shown/dismissed, or within its Later window.
- B-108/REQ-11: Each artifact/insight fingerprint can nudge at most once and must
  obey Focus Mode, quiet hours, global cooldown, reduced motion, and no
  modal/sound/focus-steal/count-pressure rules. The fingerprint must stay stable
  for the same substantive insight by using normalized scope, insight content,
  and source identity while excluding generation timestamps and per-run cache
  IDs.
- B-108/REQ-12: Clicking a Recap nudge immediately shows the strongest concrete
  observation and routes to full source-backed detail. Disabling the hint keeps
  silent caching and instant click behavior intact. This Recap default must not
  silently enable Quiet Recall, Pattern, or generic review hints.

### 3.5 Honest Failure Fallback

This fallback is an explanation path, not an LLM-free Recap insight path. It
applies when the provider is unavailable or unconfigured, a call throws or
times out, output is empty/malformed, or every item fails the evidence/quality
gate.

- B-108/REQ-13: A failed, empty, malformed, or quality-rejected background
  attempt creates no fresh Recap Delivery, ready state, or proactive nudge. It
  must not overwrite the last valid source-backed artifact with a generic scope
  summary.
- B-108/REQ-14: Last valid artifact and last attempt status are separate. An
  artifact that still matches the current scope/source snapshot, Data Boundary,
  and TTL remains immediately viewable even if a newer attempt failed. A stale,
  boundary-changed, expired, or mismatched artifact cannot be presented as the
  current Recap.
- B-108/REQ-15: When the user explicitly opens Recap and no valid artifact
  exists, the owning surface immediately shows an explanation state without an
  implicit foreground call or spinner. It may show only locally known,
  verifiable orientation facts: scope/time range, a bounded list of included or
  recently changed source titles with links, and skipped/boundary status.
- B-108/REQ-16: The local scope overview cannot generate themes, tensions,
  inferences, or next actions and cannot label tag/count/template summaries as
  insight. If the local facts have no orientation value, the state stays short
  and honest instead of padding the surface.
- B-108/REQ-17: The explanation state offers `Retry` and `View sources`; only an
  explicit Retry starts a foreground provider call and progress state. An
  unconfigured provider routes to setup. Ordinary copy says no reliable recap
  was produced without exposing provider/schema/error jargon; diagnostics may
  show attempt time, category, scope, and cost. Background retries use bounded
  backoff and remain silent.

### 3.6 Quiet Recall Supporting Boundary

This is the B-108 delivery boundary accepted by
[DEC-020](../decisions/dec-020-independent-quiet-recall-evaluation.md). The
[Quiet Recall product spec](./pa-quiet-recall-insight-timing-product-spec.md)
retains the broader product narrative; this owning spec carries the unique
B-108 traceability IDs so Active Package evidence has one authority.

- B-108/REQ-18: Each eligible Quiet Recall candidate is evaluated independently
  in deterministic rank order. A round selects at most 5 candidates, makes at
  most one initial provider call per candidate, permits only one language-
  mismatch retry for that candidate, and therefore cannot exceed 10 actual
  provider calls. One candidate's rejection or failure cannot cancel siblings.
- B-108/REQ-19: Quiet Recall has an independent persisted limiter bucket capped
  at 10 actual calls per rolling hour and 50 actual calls per local day. Every
  initial call and language retry reserves a slot before provider invocation;
  thrown, timed-out, malformed, rejected, and wrong-language calls consume the
  reserved slot. Recap, generic preload, and foreground review usage cannot
  consume or replenish this bucket.
- B-108/REQ-20: An evaluation may be reused only from an exact context-candidate
  cache key that includes current-note identity/content, candidate identity/
  content, locale, provider/model, evaluator version, and Data Boundary
  snapshot. Any component change invalidates reuse; unavailable-provider,
  budget, cooldown, timeout, and transport failures are not cached as quality
  judgments.
- B-108/REQ-21: Missing provider, cooldown, exhausted budget, failed/rejected
  evaluation, or absent exact-cache result creates no proactive Recall and no
  template/rule-generated `why now`. Local matches may remain visible only in
  an explicit Discover surface, must be labeled `Local related clue` /
  `本地关联线索`, contain no AI why-now, and must not share proactive Recall
  styling or a Recall card stack.
- B-108/REQ-22: Only independently evaluated, quality-passing candidates may
  enter the proactive Recall pool. Bubble defaults to one visible card; it may
  expose a stack of 2 to 3 cards only when every card independently passes the
  high quality gate, remains distinct and source-backed, and creates no queue
  debt. Content-free diagnostics distinguish round, initial attempt, language
  retry, cache hit, outcome category, limiter usage, and estimated cost.

## 4. Storage Policy

Recap should be stored as a local derived object by default.

Required fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable recap id |
| `scope` | Scope definition |
| `summary` | Short scope summary |
| `themes` | Recurring source-backed themes |
| `tensions` | Source-backed conflicts, counterexamples, or tradeoffs |
| `openQuestions` | Questions worth review |
| `nextReviewActions` | Suggested review actions |
| `sourceRefs` | Sources used by important claims/themes |
| `sourceCoverage` | Coverage counts and ratio |
| `skippedSources` | Excluded, unreadable, or out-of-policy sources |
| `generatedAt` | Generation time |
| `ttl` | Expiry period |
| `staleStatus` | fresh, stale, low-coverage, boundary-changed |
| `providerInfo` | Provider/model info when applicable |
| `dataBoundarySnapshot` | Data policy at generation time |
| `replayRef` | Optional replay trace |

DEC-019 requires three separate runtime objects or equivalently separated
fields:

- `lastValidArtifact`: source-backed insight content eligible only while its
  scope/source snapshot, Data Boundary, TTL, and freshness still match.
- `lastAttemptStatus`: attempt time, outcome category, scope, and cost metadata;
  it cannot overwrite artifact content.
- `localScopeOverview`: synchronous explanation-only scope/source facts built
  for explicit open. It is not persisted or ranked as a Recap insight and cannot
  enter retrieval, DeliveryCandidate, or proactive hint pools.

Recap is not:

- Raw note
- Confirmed Memory
- Saved Insight by default
- source note patch
- automatic Markdown note

## 5. Evidence Requirements

Every important claim or theme must have sourceRefs.

Important means:

- theme
- trend
- tension
- change over time
- claim about user activity
- suggestion
- next review action
- Memory Candidate seed
- Maintenance Proposal seed

The whole recap must also show source coverage.

Example coverage labels:

- `Based on 12 of 18 notes`
- `3 notes skipped by Data Boundary`
- `Low evidence: only 2 source notes`
- `Stale: 5 source notes changed since generated`

Do not rely on an end-of-document source list only. Claim-level sourceRefs are
needed for important outputs.

## 6. Output Shape

Recap should be review-oriented.

v1 output sections:

| Section | Purpose |
| --- | --- |
| Summary | What this scope is mainly about |
| Themes | Recurring ideas or patterns |
| Tensions | Conflicts, counterexamples, unresolved tradeoffs |
| Open Questions | Questions worth further thinking |
| Next Review Actions | Suggested next actions such as save insight, confirm memory, inspect source, or review maintenance |

Recap should not default to an action plan. It may suggest next review actions,
but those actions still require user confirmation and the relevant workflow.

## 7. Influence On Retrieval

Recap has weak retrieval influence.

Allowed:

- theme signal
- scope signal
- recall candidate source
- rerank hint
- future Weekly Review grouping hint, after separate product approval
- Saved Insight candidate seed

Not allowed:

- answering factual questions from recap alone
- replacing source note evidence
- overriding Confirmed Memory
- creating Memory from recap without source-backed candidate review
- acting as a durable graph/community fact

Product rule:

> Recap can help PA find the ground, but it is not the ground.

## 8. Stale Policy

Recap uses source-aware stale detection.

Mark stale when:

- source notes changed significantly
- source notes were added or removed from scope
- key source note changed
- source coverage drops below threshold
- excluded scope or Data Boundary policy changes
- TTL expires
- user marks recap unreliable

Stale recap behavior:

- show stale badge
- avoid using as strong ranking signal
- offer refresh
- keep old recap inspectable if useful
- do not write stale recap to Markdown without refresh or explicit user choice

## 9. Uncertainty Display

User-visible uncertainty should be lightweight.

Show:

- source coverage
- skipped sources
- stale badge
- low-evidence label
- generatedAt
- provider/model disclosure where relevant

Do not show ordinary users:

- chunk scores
- embedding distances
- reranker internals
- token counts
- prompt/debug trace
- raw graph expansion metrics

Detailed replay/debug data can exist behind developer or diagnostic views.

## 10. Markdown Write Policy

Recap can be written to Markdown only after user confirmation.

Potential Markdown targets after separate user confirmation and, where needed,
future integration authority:

- future Weekly Review note
- review note
- independent Recap note
- project/reference note chosen by user

Markdown output must include:

- generatedAt
- scope
- sourceRefs for important claims/themes
- coverage summary
- stale status if not fresh

Markdown output should not include:

- skipped private source details beyond safe labels
- internal scores
- unconfirmed Memory Candidates as facts
- unconfirmed Maintenance Proposals as applied actions

## 11. Relationship To Active Vault Indexer

Scope Recap is a later Active Vault Indexer lane.

Active Vault Indexer provides:

- scope resolution
- SourceRef
- RetrievalOutcome
- source coverage
- included/skipped source policy
- why-shown labels
- replay metadata
- structure/activity signals

Scope Recap adds:

- derived summary
- themes
- tensions
- open questions
- review actions
- stale-aware derived object

This should remain downstream of the evidence substrate. Do not implement recap
as a separate retrieval stack.

## 12. Relationship To Weekly Review

Weekly Review is a broader/future high-intent integration for Recap. It is not a
current B-108 surface, requirement, acceptance criterion, or completion claim.

If separately approved and implemented, Weekly Review may use recap to:

- group items by theme
- identify tensions
- suggest open questions
- propose Saved Insights
- seed Memory Candidates
- seed Maintenance Proposals

A future Weekly Review note may include user-accepted recap material, but not
the raw unreviewed recap object by default.

## 13. Relationship To Saved Insight

Recap can produce Saved Insight candidates.

Examples:

- theme -> Saved Insight of type `theme`
- tension -> Saved Insight of type `tension`
- open question -> Saved Insight of type `question`
- next review action -> possible Maintenance Proposal or Memory Candidate

Recap itself is not a Saved Insight. A user must save or accept a specific
derived idea before it becomes one.

## 14. Relationship To Graph Discovery

Graph Discovery can help recap find theme chains and tensions.

However:

- graph edges remain evidence aids
- AI-inferred edges require lifecycle state
- recap must still show sourceRefs
- full graph/community summaries are not MVP
- graph-derived themes should be low-confidence unless source-backed

## 15. Data Boundary And Privacy

Scope Recap must obey Data Boundary.

Required:

- broad/sensitive/costly scope uses plan-first source preview
- excluded folders/tags are skipped
- generated notes follow generated-note policy
- skipped sources appear as safe counts/labels
- provider disclosure if note content leaves local device
- local derived recap data is clearable
- Markdown write requires explicit user action

If a recap would include sensitive scopes, PA should show included/skipped scope
before generation.

## 16. Evaluation

Eval Harness should cover Scope Recap.

Suggested cases:

| Case | Expected behavior |
| --- | --- |
| Selected notes recap | Uses selected scope only and shows source coverage |
| Folder recap | Important themes have sourceRefs |
| Tag recap | No Project assumption appears |
| Time-range recap | Uses time range and shows skipped sources |
| Source changed | Recap becomes stale |
| Excluded folder | Excluded sources are not used |
| Low evidence | Low-evidence label appears |
| Markdown write | Requires user confirmation and includes generatedAt/sourceRefs |
| Retrieval influence | Recap weakly reranks but does not answer as fact |
| Default background preparation | After provider setup and the shared first-use notification, a changed high-intent scope can prepare one budgeted derived artifact before the user opens Recap; broad/sensitive/costly runs still stop for per-run confirmation |
| Background preparation disabled | Reload and upgrade preserve the opt-out and issue zero background Recap provider calls |
| Prepared artifact opened | Fresh source-backed insight renders immediately without waiting for another provider call |
| Empty or failed preparation | No false-ready Recap delivery is created |
| Background transparency | Last run, scope, cost usage, disable control, and cache clearing are inspectable |
| High-value fresh cross-note insight | Pet emits one restrained nudge; click immediately shows the concrete observation and sources |
| Generic summary or source-count-only output | Excluded from Recap artifact/delivery; only real local scope/source facts may appear in the explicit DEC-019 explanation state |
| Same artifact repeats | No second proactive hint after shown/dismissed; Later suppresses it for the configured window |
| Focus/quiet/cooldown suppression | No nudge, while the fresh prepared artifact remains immediately available on click |
| Recap hint disabled | No Recap nudge; background preparation and click-to-view remain available; unrelated hint defaults do not change |
| Provider unavailable or call fails | No ready candidate or nudge is created; a still-valid prior artifact remains available |
| Empty/malformed/quality-rejected insight | No generic summary masquerades as Recap Delivery; attempt status is inspectable |
| Explicit Recap open without a valid artifact | Immediately shows an honest local scope overview plus Retry/View sources, with no implicit provider call |
| Explicit Retry fails | Existing content stays visible and receives non-destructive feedback; no valid artifact is deleted |
| Five eligible Recall candidates | Each candidate is evaluated independently in rank order; one rejection or failure does not cancel siblings and the round stays within 5 initial / 10 actual calls |
| Recall hourly or daily budget reached | No further provider invocation occurs, no template why-now becomes Recall, and explicit Discover may show a local match only as a labeled local related clue without AI why-now |
| Exact Recall context-candidate repeats | A matching quality judgment may be reused without a call; changing either note, locale, provider/model, evaluator version, or Data Boundary invalidates the cache key |
| Recall provider/cooldown unavailable | No proactive Recall appears without an exact cached quality pass |
| Multiple accepted Recall candidates | Bubble shows one card by default and offers a 2-to-3-card stack only when every item independently passes the high quality gate and is distinct/source-backed |

Deterministic checks:

- every important theme has sourceRefs
- source coverage exists
- stale status changes when sources change
- recap cannot create Confirmed Memory directly
- recap cannot write Markdown without user action
- B-108/AC-01: after provider setup, default background preparation shows the
  shared first-use non-blocking notification before the first actual call,
  remains bounded by changed high-intent scope and budget, and respects a
  persisted disable preference; a first high-risk call may satisfy the shared
  disclosure through its complete blocking prompt only after affirmative Run,
  without a duplicate notice or Cancel/Adjust state mutation
- B-108/AC-02: opening a fresh prepared Recap performs no duplicate provider call
  and displays at least one source-backed item immediately
- B-108/AC-03: provider failure, empty insight output, stale evidence, or quality
  rejection creates no false-ready delivery candidate
- B-108/AC-04: diagnostics expose background activity and cost while ordinary UI
  remains quiet and free of internal implementation jargon
- B-108/AC-05: generic review preload and prepared Scope Recap have unambiguous
  settings semantics; changing one does not silently violate the other's
  documented default or user opt-out
- B-108/AC-06: standard bounded first provider-backed preparation shows the
  shared notification and proceeds without a feature-specific authorization;
  broad/sensitive/costly/whole-vault/excluded override still has zero provider
  calls and zero cost reservation before affirmative `run`, and Recap calls/cost
  remain separately attributable from generic preload
- B-108/AC-07: a fresh structured insight with at least two distinct source notes
  and a concrete why-it-matters relationship emits exactly one restrained nudge
- B-108/AC-08: summary-only, coverage-only, stale, failed, empty, low-value,
  repeated, dismissed, Later-suppressed, quiet-hours, or Focus Mode cases emit no
  Recap nudge
- B-108/AC-09: clicking a nudge displays the strongest concrete insight without
  another provider call; disabling Recap hints preserves silent cache/instant
  click and does not enable or disable other hint kinds
- B-108/AC-10: unavailable, thrown, timed-out, empty, malformed, or
  quality-rejected background attempts create neither Recap Delivery nor Pet
  nudge and do not replace a still-valid artifact
- B-108/AC-11: after a failed attempt, a prior artifact is displayed only when
  scope/source snapshot, Data Boundary, TTL, and freshness still match
- B-108/AC-12: explicit Recap open with no valid artifact renders local scope,
  source-link, change, and skipped/boundary facts synchronously without a
  provider call and labels the state as no reliable recap
- B-108/AC-13: local overview text cannot enter the insight candidate or hint
  pool, and tag/count/template summaries never qualify as Recap Delivery
- B-108/AC-14: only explicit Retry enters foreground progress; failure preserves
  existing content, while ordinary UI avoids provider/schema/error jargon and
  diagnostics retain the detailed attempt category
- B-108/AC-15: one eligible Quiet Recall round evaluates no more than 5 ranked
  candidates independently, makes no more than 5 initial and 10 total calls,
  retries only the candidate whose why-now language mismatches, and preserves
  completed sibling outcomes when any candidate fails
- B-108/AC-16: Quiet Recall blocks call 11 in a rolling hour and call 51 in a
  local day; the limiter reserves before every invocation and counts failed,
  timed-out, malformed, rejected, and language-retry calls in a persisted bucket
  that is independent from Recap, preload, and foreground review
- B-108/AC-17: an exact context-candidate cache hit performs no provider call,
  while any current-note/candidate content, locale, provider/model, evaluator-
  version, or Data Boundary change produces a miss; transient availability,
  cooldown, budget, timeout, and transport outcomes are not cached as judgments
- B-108/AC-18: missing provider, cooldown, budget exhaustion, cache miss, failed
  or rejected evaluation never creates a proactive Recall or template why-now;
  any surviving local match is visibly Discover-only, labeled as a local related
  clue, contains no AI why-now, and never mixes with proactive Recall cards
- B-108/AC-19: only independent quality passes enter proactive Recall; Bubble
  defaults to one visible card and exposes a 2-to-3-card stack only when every
  item is distinct, source-backed, high quality, and debt-free, while
  diagnostics separately account for round, initial attempt, language retry,
  cache hit, outcome, limiter usage, and estimated cost

## 17. Broader/Future Roadmap

This roadmap records directions outside the implemented B-108 current-context
contract. It is not execution status, does not reopen DEC-017 through DEC-023,
and must not be used as a B-108 completion checklist.

### Future Phase 0: Broader Product Contract

- Link this spec from Active Vault Indexer, Weekly Review, Saved Insight, Graph
  Discovery, Data Boundary, and Eval Harness.
- Keep recap as derived object, not source truth.

### Future Phase 1: Broader Selected-scope Recap

- Support selected notes and current note group.
- Return summary, themes, tensions, open questions, next review actions.
- Include sourceRefs and coverage.
- Store local derived object.

### Future Phase 2: Folder / Tag / Time-range Recap

- Add folder scope.
- Add tag scope.
- Add recent 7 / 14 day scopes.
- Add skipped source labels and stale detection.

### Future Phase 3: Weekly Review Integration

- Use recap to group Weekly Review items.
- Create Saved Insight candidates from accepted themes/tensions/questions.
- Avoid raw recap dumping into Weekly Review note.

### Future Phase 4: Saved Scope Preparation

- Let users save scopes.
- Prepare recap for saved scopes at low frequency.
- Add TTL and source-aware refresh.

### Future Phase 5: Markdown Export

- Allow user-confirmed recap notes.
- Include sourceRefs, generatedAt, coverage, and stale status.
- Support review note / Weekly Review note / independent recap note targets.

## 18. Broader/Future Questions

These questions do not block or qualify B-108 completion:

- What should the UI label be: `Recap`, `Scope summary`, `Review map`, or
  Pagelet-native wording?
- What is the first supported non-current-note scope: selected notes, folder,
  tag, or time range?
- What coverage threshold should show `low evidence`?
- What TTL should be the default for Weekly Review recap versus saved scope
  recap?
- Where should independent Recap notes be saved by default?
- Should user-written Markdown recap notes be excluded from future recap by
  generated-note policy?

## 19. Summary

Scope Recap turns hierarchical and graph-style summarization into a trustworthy
product capability.

The durable contract:

- user-selected scope, not Project assumption
- on-demand plus default-on, bounded high-intent background preparation
- local derived object by default
- sourceRefs for important claims/themes
- source coverage and uncertainty shown
- review-oriented output
- weak retrieval influence only
- source-aware stale policy
- failed/empty/rejected attempts preserve any still-valid artifact; otherwise
  explicit open shows an honest local scope/source explanation without an
  implicit provider call
- Quiet Recall evaluates candidates independently under exact-cache and
  actual-call limits, never replacing unavailable evaluation with template
  proactive copy
- Markdown only after confirmation

This lets PA summarize without pretending the summary is the user's vault.
