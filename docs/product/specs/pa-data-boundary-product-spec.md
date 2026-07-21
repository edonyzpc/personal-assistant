# PA Data Boundary Product Spec

Document status: Current
Updated: 2026-07-21
Work item: B-118
Scope note: DEC-023/DEC-024 reconciliation is owned by B-118; the base cross-feature contract predates stable Backlog IDs.
Scoped decisions: [DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md)、[DEC-024](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)
Authority: PA-wide source eligibility、exclusions、provider disclosure、storage、cleanup 与 replay data boundaries。

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Delivery / validation status | Shared v1 Data Boundary implemented; B-118 automated/review and authorized desktop/iPhone gates passed for DEC-023/DEC-024 actual-call admission, Review/preload classification, Quiet Recall semantic retrieval and live-source revalidation. Real high-risk provider calls were not executed; new data classes still require explicit extension. |
| Feature family | Data Boundary / Privacy / Local-first controls |
| Primary surfaces | Settings, Chat, Pagelet, Memory, Maintenance Review |
| Related research | [PA Agent AI insight research report](../../archive/pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Product Information Architecture spec](../pa-product-information-architecture-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [Context Pager spec](./pa-context-pager-product-spec.md), [Weekly Review spec](../../archive/pa-weekly-review-product-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Pagelet Trust Layer spec](../../archive/pagelet-trust-layer-product-spec.md), [Pagelet Maintenance Review spec](../../archive/pagelet-maintenance-review-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |
| Related runtime docs | [VSS local state plan](../../architecture/vss-local-state-plan.md), [VSS SQLite/WASM architecture](../../architecture/vss-sqlite-wasm-architecture.md) |

This spec defines PA's shared data boundary system. The shared v1 boundary is
implemented and remains the contract for source eligibility, provider
disclosure, storage, and cleanup.

The goal is to keep Chat, Pagelet, Memory, Maintenance, Active Vault Indexer,
Graph Discovery, and Eval aligned on what can be read, sent to providers,
stored locally, exported to the vault, and cleared by the user.

Ownership clarification: this spec remains canonical for PA-wide source
eligibility, exclusions, provider disclosure, and grouped cleanup. The active
[Memory Control Center spec](./pa-memory-control-center-product-spec.md) owns
Memory-specific status, lifecycle recovery, local migration, and future Memory
portability. The two Settings areas use exact deep links rather than duplicate
controls.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| DB-D1 | Build one shared Data Boundary System. | Chat/Pagelet/Memory/Maintenance/Indexer/Graph use the same excluded scopes, provider disclosure, and local/cache/vault-artifact boundaries. |
| DB-D2 | User-visible shape is a lightweight `Data & Privacy Boundaries` settings area. | Users get one place to manage boundaries without a heavy privacy control center. |
| DB-D3 | Excluded folders/tags are global hard boundaries by default, with explicit per-run override. | A run may include an excluded scope only after user-visible one-time authorization. |
| DB-D4 | AI-generated notes are excluded by default, with configurable inclusion policy. | Prevents self-reference and summary drift while allowing user-confirmed generated artifacts to become sources. |
| DB-D5 | Data cleanup is unified and grouped by data type. | Cache, queues, graph state, replay, unconfirmed memory, and confirmed memory are cleared separately. |
| DB-D6 | Provider disclosure is first-use plus actual-input-based high-risk disclosure. | Small scopes stay low-friction; foreground Review uses filtered actual source count, while consequential runs show scope/provider/cost before continuing. |
| DB-D7 | Data Boundary needs its own spec. | Privacy and local-first behavior must be consistent across all PA surfaces. |
| DB-D8 | Quiet Recall cold semantic query embedding is a real bounded provider call. | It uses DEC-023 disclosure and the existing 10/hour、50/day Quiet Recall total budget; an empty retrieval makes no downstream evaluator/generation call. |
| DB-D9 | Narrow generic background preload is standard bounded; any envelope breach fails closed silently. | Explicit opt-in、changed-only、recent 7 days、4K input/1K output、2/rolling-hour、20/local-day、read-only and actual-source shared-boundary allow can prepare quietly; all other background preload runs skip without a blocking prompt. |
| DB-D10 | Generic preload sensitivity comes from explicit shared Data Boundary rules, not content inference. | Every actual source must pass the configured folder/tag/generated-source policy with no override; unmarked allowed notes are treated as ordinary, and a caller-provided `sensitive=false` is not evidence. |
| DB-D11 | Provider-bound sources are rechecked from the exact latest Markdown body. | Explicit body tags/frontmatter and path policy are enforced at the provider seam; MetadataCache lag or malformed leading frontmatter fails closed, and model findings must cite an exact actual-input path. |
| DB-D12 | Derived Pagelet text inherits every live source boundary. | All Pagelet provider inputs combine shared and Pagelet-local source rules; a cold embedding validates its primary latest body first, and a Saved Insight reaches an evaluator only when every sourceRef is live-readable, unchanged, and allowed. |

## 1. Product Decision

PA should use one shared data boundary system, not scattered privacy rules.

Core decision:

> Data boundaries are PA-wide product contracts. They are not per-feature
> implementation details.

## 2. Product Principles

### 2.1 Local-first Means Explicit Boundaries

Local-first does not mean "never online". It means users understand:

- what stays local
- what may be sent to the configured provider
- what is stored as local cache
- what is written to the vault
- what is generated or derived
- what can be cleared or forgotten

### 2.2 Exclusion Is A Hard Default

Excluded folders and tags are not soft rerank signals. They are hard boundaries
unless the user explicitly grants a one-time per-run override.

### 2.3 Generated Is Not Automatically Source

AI-generated notes should not automatically become source material. User-saved
or user-edited generated artifacts may become sources only under a clear policy.

### 2.4 Cache, Derived State, And Confirmed User Data Are Different

Clearing a local index is not the same as deleting Confirmed Memory. Clearing a
review queue is not the same as undoing applied vault changes.

### 2.5 Disclosure Should Be Timely, Not Constant

Every provider call warning would create fatigue. The product should disclose
when scope, sensitivity, cost, or future-state impact makes disclosure relevant.

## 3. User-visible Settings

Add a lightweight settings area:

> Data & Privacy Boundaries

It should include:

- excluded folders
- excluded tags
- generated notes inclusion policy
- provider disclosure defaults
- local data cleanup
- exact deep link to Memory and personalization for Forget, future export, and
  Memory-specific repair/recovery controls
- optional advanced diagnostics

Do not make a heavy privacy dashboard in v1.

## 4. Excluded Scopes

Default behavior:

- excluded folders/tags apply to Chat, Pagelet, Memory, Maintenance Review,
  Active Vault Indexer, Graph Discovery, and Eval fixtures
- excluded scope cannot be used by model output or tool calls
- model text cannot override exclusion
- exclusion must be enforced before provider calls

Per-run override:

- allowed only through explicit UI
- one run only
- does not change global settings
- recorded in Replay Trace
- does not grant write permission
- Memory and Maintenance actions still need their own confirmation

User-facing example:

```text
This source is excluded by default:
private/

Include it for this run only?

Include once / Keep excluded
```

## 5. Generated Notes Policy

Generated notes include:

- `.pagelet/` review notes
- saved AI summaries
- future Memory export notes
- generated index/MOC notes
- generated maintenance summaries

Default:

> Exclude generated notes from ordinary retrieval, Memory, Maintenance, and
> discovery scans.

Configurable policies:

| Policy | Meaning |
| --- | --- |
| exclude generated notes from all retrieval | safest default |
| include user-saved review notes | allows confirmed review artifacts |
| include selected generated folder | user chooses a folder as source-worthy |
| include only after user marks as source-worthy | per-artifact promotion |

Recommended source-worthiness rule:

- AI transient output is not source.
- User-saved review note can become source under policy.
- User-edited or user-confirmed generated note is stronger source.
- Whole generated folder stays excluded unless user changes policy.

## 6. Provider Disclosure

Provider disclosure has two levels:

1. First use of standard bounded Pagelet note reading through a configured
   provider uses one shared, non-blocking notification and continues the
   requested/eligible run. Features must not create or reset parallel first-use
   authorization state.
2. Broad, costly, sensitive, whole-vault, or excluded-scope-override runs use a
   blocking per-run disclosure before any provider call or cost reservation.

This first-use rule is owned by
[DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md) and covers
standard bounded Scope Recap, Quiet Recall, Discover, and B-119 Graph、Pattern、
Maintenance runs. The second rule applies as soon as a run exceeds its standard
envelope. Provider trust does not grant Memory admission, vault write, Markdown,
or external-action authority.

[DEC-024](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md) clarifies
that a cold Quiet Recall query embedding is an actual standard-bounded Pagelet
provider call, even though the subsequent vector search runs against the local
Memory/VSS index. It may enter shared first-use admission only after capability,
provider, allowed source/query, index-ready, cooldown, existing Quiet Recall
10/hour、50/day budget and source/current-run revalidation pass. The embedding
attempt consumes that existing bucket without increasing it. If local search
then returns no candidates, downstream evaluator/generation calls are 0.

If the first actual Pagelet provider call is itself broad, sensitive, costly,
whole-vault, out-of-envelope, or an excluded-scope override, its blocking
disclosure also satisfies the shared first-use disclosure when it fully covers
the allowed note excerpts/data, provider, possible cost, and capability opt-out.
Do not stack a second non-blocking notice onto that confirmed run.

Risk classification uses the post-filter, de-duplicated input that is actually
eligible to be sent, not the requested time-range label:

| Pagelet path | Standard bounded envelope | Out-of-envelope behavior |
| --- | --- | --- |
| Foreground Review | Actual included allowed sources `<=1`; `current` or requested `last7` are equivalent when only one source remains | Actual included allowed sources `>1` requires per-run `Run / Adjust / Cancel`; before affirmative confirmation, provider call、quota/cost reservation and shared-flag mutation are all 0 |
| Generic background preload | Explicit opt-in; changed-only; recent 7 days; actual provider input `<=4K`; requested output `<=1K`; actual calls `<=2` per rolling hour and `<=20` per local day; `allowWrite=false`; no sensitive、whole-vault or excluded-scope override | Silently skip / fail closed; no blocking confirmation UI、provider call、quota/cost reservation or shared-flag mutation |

The phrase “broad / weekly scan is high-risk” does **not** include the narrow
changed-only preload envelope above. Other foreground Review runs are classified
by actual allowed source count. A background preload that breaches any envelope
condition is not promoted into an interactive high-risk run; it stays silent and
does no work.

For this background envelope, “no sensitive source” is an explicit-boundary
statement rather than automatic content classification. Runtime must derive it
from the current decisions for every actual source under shared excluded-folder,
excluded-tag, and generated-source policy, with no per-run override. It must not
trust a caller-owned `sensitive=false` flag or use keyword/AI guessing. A note
that the user has not placed behind one of those boundaries remains an ordinary
allowed source.

The 2-per-rolling-hour and 20-per-local-day limits survive plugin reload and
Pagelet off/on cycles. Runtime may persist only content-free, vault-scoped call
timestamps for this guard. Missing or malformed guard storage fails closed;
restarting the plugin must not restore unattended capacity.

Changed-only eligibility uses a separate content-free, vault-scoped per-path
mtime watermark. It also survives reload and Pagelet off/on, advances only for
the captured source snapshots of an accepted real provider run, and does not
advance on a no-call/fail-closed result. Missing storage access or malformed
state fails closed; a missing key after fresh opt-in is a valid empty baseline.

MetadataCache is an optimization, not final proof of eligibility. Immediately
before a provider call, runtime must use the just-read Markdown body to recheck
explicit inline tags, frontmatter tags/generated markers, and path policy. If a
leading frontmatter block cannot be parsed reliably, the source is skipped.
Provider output may be cached or shown only when each finding's source path
exactly matches one of that invocation's actual allowed input paths.

| Operation | Disclosure / confirmation |
| --- | --- |
| Standard bounded Pagelet provider note reading | One shared first-use non-blocking notification; eligible run continues |
| Cold Quiet Recall semantic query embedding | Same shared first-use admission; one actual call in the existing Quiet Recall 10/hour、50/day bucket, followed by local vector search |
| First actual Pagelet provider call is high-risk | One complete blocking disclosure may also satisfy shared first-use; no extra non-blocking notice |
| Foreground Review, actual allowed sources `<=1` | Standard bounded shared first-use admission, even when requested scope is `last7` |
| Foreground Review, actual allowed sources `>1` | Blocking per-run `Run / Adjust / Cancel`; no quota/cost reservation before confirmation |
| Generic background preload inside the exact narrow envelope | Standard bounded shared admission; read-only and explicitly opted in |
| Generic background preload outside any envelope condition | Silent skip / fail closed; no blocking prompt, call, reservation, cost, or flag mutation |
| Broad / sensitive / costly / whole-vault / out-of-envelope / excluded override | Blocking per-run `run / adjust / cancel` before provider call or cost reservation, even when the shared flag is already true |
| Prepare / Update Memory and Memory admission | Existing Memory-specific confirmation and cost contract |
| Vault mutation, Markdown, or external action | Separate effect-based preview / confirmation contract; provider notice is insufficient |

Disclosure should happen:

- on first use of provider-backed note reading
- immediately before an admitted cold Quiet Recall query embedding when it is
  the first actual Pagelet provider call
- before admitted foreground or explicitly initiated broad/costly/sensitive
  runs; an out-of-envelope generic background preload skips instead of prompting
- before first Prepare/Update Memory under its Memory-specific contract
- before foreground Pagelet Review whose filtered, de-duplicated actual allowed
  source set contains more than one source
- before Maintenance scan over broad scope
- before runs that generate Memory Candidates or Confirmed Memory
- when excluded/sensitive scopes are temporarily included

The shared first-use notification should show, in ordinary product language:

- that allowed note excerpts may be sent to the configured AI provider
- that API credits/cost may be used
- where the capability can be disabled

Blocking broad/costly/sensitive disclosure should show:

- allowed note excerpts/data that may be sent
- included scope
- excluded scope
- provider/model when relevant
- "note text may be sent to the configured AI provider"
- possible API credits/cost
- where the capability can be disabled
- run / adjust / cancel

For a first high-risk call, set `pageletProviderFirstUseNotified=true` only after
the user explicitly chooses `Run`, every gate passes, and the provider invocation
is immediately next. `Cancel` or passive close leaves it false. `Adjust` must be
re-evaluated: a still-high-risk run repeats the blocking gate, while a run reduced
to the standard bounded envelope uses the ordinary shared notice. Later high-risk
runs still require per-run confirmation regardless of the shared flag.

Eligible bounded runs, after the shared first-use notice has been shown when
needed, should not repeat heavy disclosure each time.

Strict zero-call Quiet Recall paths remain: no eligible source or valid query,
Memory index not ready, capability disabled, provider unavailable, Data Boundary
deny, cooldown/budget denial before cold-retrieval admission, and source/current-
run invalidation before the first invocation. An exact valid query-embedding
cache hit is local-only for this run.
When the index is unavailable, metadata may support only a clearly labeled
explicit-Discover local clue; it cannot be represented as semantic relevance,
AI-evaluated Recall, or proactive `nudge`. Provider results and candidates must
be discarded if source revalidation fails before use.

## 7. Data Cleanup

Provide unified Data Cleanup grouped by data type.

Groups:

| Group | Meaning | Notes |
| --- | --- | --- |
| local Memory index | OPFS/embedding/index cache | does not delete vault notes |
| review / maintenance queues | pending local review items | does not undo applied vault changes |
| derived graph / discovery state | AI-inferred edges and discovery cache | does not remove user-created links |
| replay traces | local explanation/eval metadata | may affect debugging and audit |
| unconfirmed memory candidates | pending candidates | does not delete Confirmed Memory |
| confirmed memory | user-confirmed durable PA memory | requires explicit confirmation/export options |
| memory deletion markers | text-free local tombstones | prevent re-suggestion; clearable separately from memory content |

Rules:

- cache and user-confirmed data must be separate
- unconfirmed and confirmed memory must be separate
- deleting Confirmed Memory requires explicit confirmation
- forgetting Confirmed Memory removes saved memory content and leaves only a
  text-free deletion marker unless the user clears deletion markers
- archiving Confirmed Memory keeps content but prevents automatic use
- clearing local index does not modify Markdown notes
- clearing queue does not undo applied vault changes
- action log and undo metadata need retention policy before deletion

An advanced "Reset PA local data" can exist later, but it must explain exactly
which groups it clears.

## 8. Storage Boundaries

| Data type | Default storage | Boundary |
| --- | --- | --- |
| Markdown source notes | vault | user source of truth |
| local Memory index | OPFS/local cache | reconstructable cache |
| VSS/local marker state | IndexedDB/local app state | device-local runtime state |
| review/maintenance queue | local store | machine state, not vault content |
| graph/discovery edges | local derived state | AI-inferred unless user confirms |
| Governed Memory | versioned device-local store + Memory and personalization | user-visible, current-vault by default; not vault-polluting or cross-device by default |
| memory suppression markers | versioned device-local store | text-free prevention state; cleared from Memory and personalization |
| vault artifacts | Markdown notes after user action | searchable/syncable user-owned output |
| replay traces | local store by default | explainability/eval metadata; no private note text by default |

Markdown vault remains the source of truth for user notes. Local runtime state
must not create or update vault files by default.

## 9. Surface Requirements

| Surface | Data boundary behavior |
| --- | --- |
| Chat | honors exclusions; broad/sensitive questions use scope/provider disclosure; sources shown after answer |
| Pagelet | shows included/skipped sources; all provider inputs combine shared Data Boundary and Pagelet-local source exclusions; generated notes excluded by default; foreground Review uses actual allowed-source count (`<=1` standard, `>1` blocking); narrow opted-in changed-only preload uses the 7-day/4K/2-hour/20-day/read-only envelope and silently skips on breach; Quiet Recall cold embeddings validate the primary live body before DEC-023 admission and use the existing 10/50 budget; Saved Insight text requires every sourceRef to pass live all-or-nothing validation; metadata-only fallback stays local Discover-only |
| Memory | candidates require sourceRefs; Confirmed Memory managed separately; excluded scopes do not create candidates |
| Maintenance Review | scans respect excluded scopes; affected scope shown; write actions have separate confirmation |
| Active Vault Indexer | centralizes exclusions, generated note policy, sourceRefs, and retrieval outcomes |
| Graph Discovery | does not use excluded/generated scopes unless allowed; rejected/derived edges remain local |
| Eval Harness | synthetic fixtures include excluded/private cases and assert no leakage |

## 10. Replay And Audit

Replay Trace should record data-boundary-relevant facts:

- included scope
- excluded scope
- per-run override if any
- generated-notes policy used
- provider/model if relevant
- whether note text may have been sent
- memory/maintenance confirmation state
- cleanup or deletion action if relevant

Replay should not persist full private note text unless a separate product and
security review approves that behavior.

### 10.1 Text Retention Boundary

Use two shapes:

| Shape | May include private excerpt text? | Storage rule |
| --- | --- | --- |
| UI source ref | Yes, while rendering a visible answer/card/pager | Session/UI state only; rehydrate from vault under current Data Boundary checks |
| Persisted replay source ref | No by default | Store path/heading/block/hash/reason/evidence metadata, not raw private text |

Persisted replay may store:

- source path
- heading or block id
- content hash / excerpt hash
- why-shown / why-skipped reason
- evidence strength
- retrieval outcome id
- provider/model metadata when relevant

Persisted replay must not store raw source excerpts, full prompts, full note
chunks, or full provider output unless a future spec defines redaction,
retention, cleanup, export, and security review gates.

## 11. Metrics

Product metrics:

- scope preview adjustment rate
- excluded-scope override rate
- provider disclosure cancel rate
- generated-note inclusion changes
- data cleanup usage
- Confirmed Memory export/delete usage
- privacy-related user corrections

Quality gates:

- excluded paths do not appear without explicit per-run override
- generated notes are excluded by default
- provider disclosure appears for admitted foreground/explicit broad、sensitive、
  costly runs; out-of-envelope generic background preload remains silent
- first-use disclosure is recorded only at an imminent real provider call;
  high-risk Cancel/close/unpassed Adjust leaves the shared flag unchanged
- foreground Review requested as `last7` but reduced to one actual allowed source
  remains standard bounded; more than one actual source reserves no quota/cost
  before affirmative per-run confirmation
- generic background preload runs only inside the complete opt-in、changed-only、
  recent-7-day、4K input/1K output、2/rolling-hour、20/local-day、read-only、
  actual-source shared-boundary-allow envelope; any single
  breach silently produces zero prompt/call/reservation/flag mutation
- an admitted cold Quiet Recall embedding counts as the real call even when
  retrieval is empty; all pre-embedding deny/stale paths remain zero-call, and
  post-call stale results are never used
- clearing local index does not delete vault notes
- clearing queue does not undo applied actions
- Confirmed Memory deletion requires explicit confirmation

## 12. Phased Roadmap

### Phase 0: Product Contract

Status: this document.

- Define shared data boundary decisions.
- Define settings shape.
- Define exclusion, generated notes, cleanup, and disclosure rules.

### Phase 1: Unified Exclusion Contract

- Centralize excluded folder/tag behavior.
- Ensure Chat, Pagelet, Memory, Maintenance, Indexer, and Graph reference the same policy.
- Add eval fixtures for excluded/private leakage.

### Phase 2: Generated Notes Policy

- Identify generated artifacts.
- Exclude `.pagelet/` and generated notes by default.
- Add user-selectable inclusion policy.

### Phase 3: Provider Disclosure

- Add first-use disclosure.
- Add actual-source foreground Review classification and broad/sensitive/costly
  run disclosure.
- Add the narrow generic background preload envelope and silent fail-closed path.
- Connect with `Sources to check` and Pagelet included/skipped scope UI.

### Phase 4: Unified Data Cleanup

- Group cleanup controls by data type.
- Separate cache, queues, derived state, unconfirmed memory, and Confirmed Memory.
- Add clear warnings for irreversible or recovery-affecting actions.

### Phase 5: Replay Boundary Metadata

- Record scope/disclosure/override metadata in Replay Trace.
- Keep full private content out of trace by default.

## 13. Open Questions

- Should the settings section be top-level or under existing Memory/Pagelet settings?
- Which generated-note policy should be default for user-saved Pagelet reviews?
- How long should replay traces be retained?
- Should per-run excluded-scope override require a second confirmation for Memory/Maintenance workflows?
- What exact tags should ship as default exclusions: `#private`, `#no-ai`, `#no-review`?

## 14. Non-goals

- No full privacy control center in v1.
- No per-feature privacy rule divergence.
- No hidden provider calls over broad/sensitive scopes.
- No treating a requested `last7` label as high-risk when only one actual allowed
  foreground source remains.
- No blocking prompt or background call when generic preload exceeds any part of
  its narrow standard envelope.
- No metadata-only candidate masquerading as semantic/proactive Quiet Recall.
- No model-controlled override of exclusions.
- No treating AI-generated notes as source by default.
- No one-click destructive wipe without grouped explanation.
- No vault-written runtime state by default.

## 15. Summary

Data Boundary System keeps PA's local-first promise concrete.

The intended product shape is:

- one shared exclusion policy
- one lightweight settings area
- explicit per-run override for excluded scopes
- generated notes excluded by default
- grouped data cleanup
- first-use plus broad/sensitive/costly provider disclosure
- foreground Review classification by actual allowed sources and a narrow,
  silent-fail-closed background preload envelope
- Quiet Recall cold semantic embedding inside the unchanged 10/hour、50/day
  total actual-call boundary
- replay metadata for boundary decisions

This gives PA room to become powerful without making privacy behavior scattered
or surprising.
