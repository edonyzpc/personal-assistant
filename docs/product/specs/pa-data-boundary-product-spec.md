# PA Data Boundary Product Spec

Document status: Current
Updated: 2026-10-05
Work item: B-118
Scope note: DEC-023/DEC-024 reconciliation is owned by B-118; DEC-027/B-125 adds one narrow local-topology exception without changing excluded content/provider/output eligibility; DEC-028's narrow Memory exception is owned by B-126; the base cross-feature contract predates stable Backlog IDs.
Scoped decisions: [DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md)、[DEC-024](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)、[DEC-027](../decisions/dec-027-bounded-retrieval-recovery.md)、[DEC-028](../decisions/dec-028-silent-memory-auto-prepare.md)
Authority: PA-wide source eligibility、exclusions、provider disclosure、storage、cleanup 与 replay data boundaries。

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / current durable contract |
| Delivery / validation status | Shared v1 Data Boundary implemented; B-118 automated/review and authorized desktop/iPhone gates passed for DEC-023/DEC-024 actual-call admission, Review/preload classification, Quiet Recall semantic retrieval and live-source revalidation. DEC-027 adds the approved B-125 single-opaque-bridge topology exception without extending content、provider、output or persistence eligibility；B-125 implementation/validation and per-flag rollout dispositions are closed in its [compact evidence](../../archive/2026/b-125-retrieval-optimization-closeout.md). DEC-028/B-126 first-use Memory exception is approved and validated under the B-126 package. Real high-risk provider calls were not executed; new data classes still require explicit extension. |
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
| DB-D3 | Excluded folders/tags are global hard content、identity、candidate、output and provider boundaries by default, with explicit per-run override. | A run may read or expose an excluded scope only after user-visible one-time authorization; DEC-027's zero-content opaque topology bridge is not such an override. |
| DB-D4 | AI-generated notes are excluded by default, with configurable inclusion policy. | Prevents self-reference and summary drift while allowing user-confirmed generated artifacts to become sources. |
| DB-D5 | Data cleanup is unified and grouped by data type. | Cache, queues, graph state, replay, unconfirmed memory, and confirmed memory are cleared separately. |
| DB-D6 | Provider disclosure is first-use plus necessary scope/cost confirmation under DEC-051. | Clarify unclear targets/sources/scope; explain and confirm actual changes beyond existing authorization or accepted cost. Source count alone never requires another confirmation. |
| DB-D7 | Data Boundary needs its own spec. | Privacy and local-first behavior must be consistent across all PA surfaces. |
| DB-D8 | Quiet Recall cold semantic query embedding is a real bounded provider call. | It uses DEC-023 disclosure and the existing 10/hour、50/day Quiet Recall total budget; an empty retrieval makes no downstream evaluator/generation call. |
| DB-D9 (historical generic lane) | Narrow generic background preload was standard bounded; any envelope breach failed closed silently. | Its explicit opt-in and numeric envelope describe the superseded generic implementation, not the current background discovery preference; see the scoped successor below. |
| DB-D10 | Generic preload sensitivity comes from explicit shared Data Boundary rules, not content inference. | Every actual source must pass the configured folder/tag/generated-source policy with no override; unmarked allowed notes are treated as ordinary, and a caller-provided `sensitive=false` is not evidence. |
| DB-D11 | Newly materialized retrieval and Pagelet current-evidence sources are checked against the exact latest Markdown body. | Explicit body tags/frontmatter and path policy are enforced; MetadataCache lag or malformed leading frontmatter fails closed, and findings cite an actual-input path. Ordinary Chat may retain an authorized read snapshot under DEC-040/B-149; revocation still blocks reuse. |
| DB-D12 | Derived Pagelet text inherits every live source boundary. | All Pagelet provider inputs combine shared and Pagelet-local source rules; a cold embedding validates its primary latest body first, and a Saved Insight reaches an evaluator only when every sourceRef is live-readable, unchanged, and allowed. |
| DB-D13 | DEC-028 authorizes one narrow silent Memory admission path. | A first-use Chat may schedule one whole eligible vault Memory rebuild without a blocking Modal; reset/provider work requires hydrated known absence or durable marker invalidation, this authority does not derive from Pagelet provider trust, and recovery/manual/costly Memory runs still block. |
| DB-D14 | PPR may locally traverse at most one excluded Markdown node as an opaque bridge. | The bridge contributes only transient link topology; it never becomes a seed/candidate/result/source or exposes body、excerpt、title、path、metadata. Generated notes、attachments and excluded chains cannot bridge. |

Scoped successor: B-123 replaced the generic preload lane with Pagelet Agent
discovery. [DEC-033 / B-106](./pa-simple-settings-product-spec.md) uses
`pagelet.backgroundDiscoveryEnabled` for automatic discovery, defaults missing
values to true, preserves valid new false, and never inherits retired enable
keys. Generic preload opt-in and its old envelope references in this document
are historical; they must not recreate a removed switch or override the
current Agent admission and budget. Explicit discovery and all effective
source, disclosure, write, and lifecycle boundaries remain enforced.

[DEC-051](../decisions/dec-051-proportionate-confirmation-and-contract-alignment.md)
also supersedes the old foreground one-source/multiple-source risk split. Current
explicit discovery has no accumulated-count cap and does not consume automatic
quota; automatic Deep Discover defaults to 12/hour and 36/day started runs,
internally adjustable without new UI. DB-D8's 10/50 budget describes the old
Quiet Recall provider-call bucket only; it neither activates that pipeline nor
becomes the current discovery quota. New implementation/validation belongs to
[B-161](../../development/active/contract-alignment/tracker.md); B-118 evidence
in the status and history sections remains evidence for the old inputs.

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
for reading、seed/candidate eligibility、result/source identity、provider input、
UI and persisted observation unless the user explicitly grants a one-time
per-run override.

DEC-027 adds one narrow local-topology exception: PPR may cross one excluded
Markdown routing node without reading or exposing it. This exception is not an
override, cannot authorize any provider/model input, and cannot make the bridge
itself relevant evidence.

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

Use the lightweight detail under Settings -> Notes & privacy:

> Data & Privacy Boundaries

It should include:

- excluded folders
- excluded tags
- generated notes inclusion policy
- provider disclosure defaults
- a precise route to local data cleanup under Advanced & maintenance
- exact deep links to Notes & privacy -> Memory and personalization for Forget
  and future export, and Advanced & maintenance -> Data and recovery for
  Memory-specific repair/recovery controls
- optional advanced diagnostics

Do not make a heavy privacy dashboard in v1.

Under [B-106](./pa-simple-settings-product-spec.md), editing global,
Memory-specific, Pagelet-specific, or automatic-property-update exclusions
changes only a local text draft. Save scope persists a narrow snapshot before
publishing the new effective scope; waiting or failure must not broaden reads
or automatic writes. Failed saves retain the draft and previous effective
scope with a retry action. Reopening Settings preserves a pending transaction
and its latest draft. Generated-note policy, write-audit retention, and
permission toggles follow the same persist-before-effective rule.

## 4. Excluded Scopes

Default behavior:

- excluded folders/tags apply to Chat, Pagelet, Memory, Maintenance Review,
  Active Vault Indexer, Graph Discovery, and Eval fixtures
- excluded scope cannot be read, returned, cited, stored or used by model output
  or provider-bound tool observations
- model text cannot override exclusion
- exclusion must be enforced before provider calls

Opaque bridge exception for DEC-027/B-125:

- only one excluded Markdown node may be traversed within a PPR restart excursion
- it is never a seed、candidate、result、sourceRef or why-shown reason
- its body、excerpt、title、path and metadata never enter model/provider input、
  UI、returned DTO、diagnostics、telemetry or Replay Trace
- an internal path key may exist only in the invocation's transient graph frame
  to resolve adjacency and is destroyed with that computation
- generated notes and attachments cannot bridge
- `excluded → excluded` and a second excluded node in the same excursion are blocked
- the final allowed candidate is checked again before local vector work and after
  Worker results return

This topology-only exception neither changes global settings nor counts as the
explicit per-run override below.

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

Generated notes remain ineligible as DEC-027 opaque bridges even when an
ordinary excluded Markdown note could provide local topology. This prevents
AI-generated summaries or MOCs from recursively amplifying their own links.

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
2. A real change beyond existing authorization or disclosed/accepted cost needs
   explanation and confirmation before that effect. Real target/source/scope
   ambiguity needs clarification; broad labels or source counts alone do not.

This first-use rule is owned by
[DEC-023](../decisions/dec-023-shared-pagelet-provider-first-use.md) and covers
standard bounded Scope Recap, Quiet Recall, Discover, and B-119 Graph、Pattern、
Maintenance runs; those B-119 references do not activate its future scope. The
second rule follows DEC-051's current authority/cost boundary. Provider trust does not grant Memory admission, vault write, Markdown,
or external-action authority.

[DEC-028](../decisions/dec-028-silent-memory-auto-prepare.md) is a separate,
owner-approved Memory-specific exception recorded on 2026-08-11. When Memory is
enabled, a configured provider/token is available, the user sends the first
Chat message, and VSS is genuinely `first-use`/uninitialized, PA may start one
whole eligible vault rebuild in the background and answer immediately. Folder,
tag, generated-note, and other source exclusions still apply. The exception is
not inherited from DEC-023 shared Pagelet first-use state and does not extend to
missing local index, profile/settings stale, manual Prepare/Update, or other
non-first-use costly rebuilds. Settings must continuously disclose note-text
transfer, provider/API cost, notes-unchanged behavior, and the Memory opt-out.
Unresolved marker truth because hydration/invalidation is unavailable stops
before reset and provider work. Only durable usable success plus
policy/lifecycle admission may
clear the original rebuild reason and enable automatic maintenance; failed
admission compensates to non-ready.

[DEC-024](../decisions/dec-024-quiet-recall-cold-semantic-retrieval.md) clarifies
that a cold Quiet Recall query embedding is an actual standard-bounded Pagelet
provider call, even though the subsequent vector search runs against the local
Memory/VSS index. It may enter shared first-use admission only after capability,
provider, allowed source/query, index-ready, cooldown, existing Quiet Recall
10/hour、50/day budget and source/current-run revalidation pass. The embedding
attempt consumes that existing bucket without increasing it. If local search
then returns no candidates, downstream evaluator/generation calls are 0.

If the first actual Pagelet provider call needs new authorization or exceeds the
already disclosed and accepted cost scope under DEC-051, its blocking
disclosure also satisfies the shared first-use disclosure when it fully covers
the allowed note excerpts/data, provider, possible cost, and capability opt-out.
Do not stack a second non-blocking notice onto that confirmed run.

Confirmation uses actual requested scope and authority, not source count or a
requested time-range label. Agent reasoning owns semantic ambiguity; source
admission still enforces the actual allow/exclusion decisions:

| Pagelet path | Standard bounded envelope | Out-of-envelope behavior |
| --- | --- | --- |
| Explicit Review / discovery | Actual sources pass the selected scope and Data Boundary; no accumulated-count cap or automatic-pool debit | Clarify real ambiguity; explain and confirm a change beyond existing authority or accepted cost before the new effect; no count-based second confirmation |
| Current automatic Deep Discover | Source/provider admission, lifecycle and adjustable 12/hour, 36/day started-run defaults | Quietly skip when admission fails; do not create a blocking background dialog |
| Historical generic preload | Old opt-in, changed-only, 7-day, 4K/1K and 2/20 provider-call envelope | Retired lane only; not a current discovery gate or setting |

Broad/weekly labels and multiple sources do not themselves require confirmation.
Already accepted authority is not requested again. A background task that cannot
be admitted stays quiet rather than becoming an interactive confirmation flow.

In the historical generic envelope, “no sensitive source” was an explicit-boundary
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

B-125 reranker candidate excerpts are provider inputs and must be Data-Boundary
filtered before serialization. Runtime attributes the call to the one selected
model: configured policy model, otherwise Chat model. A failure does not cascade
to a second model invocation. Opaque bridge identity or content is never part of
the reranker request.

| Operation | Disclosure / confirmation |
| --- | --- |
| Standard bounded Pagelet provider note reading | One shared first-use non-blocking notification; eligible run continues |
| Cold Quiet Recall semantic query embedding | Same shared first-use admission; one actual call in the existing Quiet Recall 10/hour、50/day bucket, followed by local vector search |
| First actual Pagelet provider call needs new scope/cost confirmation | One complete disclosure may also satisfy shared first-use; no extra non-blocking notice |
| Explicit Review with one or multiple allowed sources | Shared first-use admission; no count-based risk gate, accumulated-count cap, or automatic-pool debit |
| Historical generic background preload inside the exact narrow envelope | Predecessor evidence only: standard bounded shared admission, read-only and explicitly opted in; not a current discovery gate |
| Historical generic background preload outside any envelope condition | Predecessor evidence only: silent skip / fail closed, no blocking prompt, call, reservation, cost, or flag mutation; does not restore the retired lane |
| Actual request exceeds existing authorization or accepted cost; excluded override lacks authorization | Explain the change and obtain the necessary confirmation before proceeding; the shared flag cannot grant that new authority |
| First Chat with uninitialized Memory | DEC-028 narrow exception: schedule a non-blocking whole eligible vault rebuild and answer-now; reset/provider work requires hydrated known absence or durable marker invalidation, with auto enable only after durable usable success plus policy/lifecycle admission |
| Missing local index, profile/settings stale, manual Prepare/Update, or other costly Memory rebuild | Blocking Memory-specific confirmation and cost disclosure before provider call |
| Vault mutation, Markdown, or external action | Domain authorization remains separate from provider notice. DEC-051 permits current explicit Operations requests without a second confirmation; Ghost concrete-version and other domain boundaries remain |

Disclosure should happen:

- on first use of provider-backed note reading
- immediately before an admitted cold Quiet Recall query embedding when it is
  the first actual Pagelet provider call
- before an effect goes beyond existing authorization or accepted cost; background
  admission failure stays quiet instead of prompting
- persistently in Settings before DEC-028 silent first-use is eligible; all non-first-use Prepare/Update paths retain blocking Memory-specific disclosure
- when an actual target/source/scope ambiguity requires clarification; neither
  multiple Review sources nor a broad local Maintenance scan alone adds a gate
- for Memory changes when required by the [Memory Control Center effect/risk contract](./pa-memory-control-center-product-spec.md), not merely because a candidate exists
- when excluded/sensitive scopes are temporarily included

The shared first-use notification should show, in ordinary product language:

- that allowed note excerpts may be sent to the configured AI provider
- that API credits/cost may be used
- where the capability can be disabled

Necessary scope/cost confirmation should explain the actual change, including:

- allowed note excerpts/data that may be sent
- included scope
- excluded scope
- provider/model when relevant
- "note text may be sent to the configured AI provider"
- possible API credits/cost
- where the capability can be disabled
- run / adjust / cancel

For a first call that needs new confirmation, set `pageletProviderFirstUseNotified=true` only after
the user explicitly chooses `Run`, every gate passes, and the provider invocation
is immediately next. `Cancel` or passive close leaves it false. `Adjust` must be
re-evaluated against the adjusted scope. Do not repeat authorization already
accepted; use the ordinary shared notice if no new confirmation is needed. Later
changes beyond authority/cost still require confirmation regardless of the flag.

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
| Governed Memory | versioned device-local store + Notes & privacy -> Memory and personalization | user-visible, current-vault by default; not vault-polluting or cross-device by default |
| memory suppression markers | versioned device-local store | text-free prevention state; cleared from Advanced & maintenance -> Data and recovery |
| vault artifacts | Markdown notes after user action | searchable/syncable user-owned output |
| replay traces | local store by default | explainability/eval metadata; no private note text by default |

Markdown vault remains the source of truth for user notes. Local runtime state
must not create or update vault files by default.

## 9. Surface Requirements

| Surface | Data boundary behavior |
| --- | --- |
| Chat | honors exclusions; broad/sensitive questions use scope/provider disclosure; sources shown after answer; DEC-027 retry hint paths remain non-evidence and opaque bridges never enter the model observation |
| Pagelet | shows included/skipped sources; provider inputs combine shared and Pagelet-local exclusions; generated notes remain excluded by default. DEC-051 replaces source-count confirmation and manual caps; automatic Deep Discover uses adjustable 12/36 started-run defaults. Generic preload is historical; old Recall's 10/50 call bucket is separate. Saved Insight inputs require all sourceRefs allowed/current; metadata-only fallback stays local. B-125 delivery checks live evidence; bridge/hint paths are not sources |
| Memory | candidates require sourceRefs; Confirmed Memory managed separately; excluded scopes do not create candidates |
| Maintenance Review | scans respect excluded scopes; affected scope shown; write actions have separate confirmation |
| Active Vault Indexer | centralizes exclusions, generated note policy, sourceRefs, and retrieval outcomes |
| Graph Discovery | excluded/generated nodes never become items or evidence; only DEC-027 PPR may transiently cross one non-generated excluded Markdown bridge, with no identity/content exposure; rejected/derived edges remain local |
| Eval Harness | synthetic fixtures include excluded/private cases, the one-opaque-bridge positive case, generated/attachment/excluded-chain negatives, and identity/content leakage assertions |

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

Scoped delivered amendment (2026-09-23): [DEC-041](../decisions/dec-041-agent-debug-view-and-local-history.md)
and the [B-145 Debug design](./pa-agent-debug-view-product-spec.md) define the
owner-approved Chat Debug exception for device-local, filtered body/prompt
history, up to 30 days with capacity eviction, linked deletion, session-only
reasoning and attachment references only. Debug export/sync is outside that
scope. Filtering, deletion-race and storage-boundary gates passed in the
[B-145 local validation](../../archive/2026/b145-agent-debug-validation.md);
this does not prove iOS device behavior or beta installation. Default
content-free observability and excluded-source boundaries remain unchanged.

An opaque bridge is not a replay source or skipped source. Replay may record only
content-free aggregate facts such as `opaqueBridgeCount`, never the bridge's
path、title、hash、metadata or adjacency identity.

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

- excluded paths do not appear as seed、candidate、result、source、provider input、
  UI、diagnostic or replay identity without explicit per-run override
- the DEC-027 positive topology fixture can surface the final allowed note across
  exactly one excluded Markdown bridge, while generated/attachment/second-
  excluded cases remain unreachable and every bridge leakage spy stays empty
- generated notes are excluded by default
- shared first-use provider disclosure remains; under DEC-051, further confirmation
  explains an actual change beyond existing authorization or disclosed/accepted
  cost, rather than treating broad/sensitive/costly labels as automatic gates.
  Current background admission failure stays quiet; the generic preload envelope
  describes historical behavior only
- first-use disclosure is recorded only at an imminent real provider call;
  Cancel/close/unpassed Adjust during a necessary scope/cost confirmation leaves
  the shared flag unchanged; already accepted authority is not requested again
- clear foreground requests with one or multiple allowed sources have no source-count
  gate; actual ambiguity or changes beyond accepted scope/cost are handled before
  the newly unauthorized effect, without repeating valid authorization
- the historical generic background preload ran only inside the complete opt-in、changed-only、
  recent-7-day、4K input/1K output、2/rolling-hour、20/local-day、read-only、
  actual-source shared-boundary-allow envelope; any single
  breach silently produced zero prompt/call/reservation/flag mutation; this is
  retained historical evidence, not a current discovery gate
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

- Settings placement is resolved by B-106: Notes & privacy, with cleanup/recovery under Advanced & maintenance.
- Which generated-note policy should be default for user-saved Pagelet reviews?
- How long should replay traces be retained?
- Should per-run excluded-scope override require a second confirmation for Memory/Maintenance workflows?
- What exact tags should ship as default exclusions: `#private`, `#no-ai`, `#no-review`?

## 14. Non-goals

- No full privacy control center in v1.
- No per-feature privacy rule divergence.
- No hidden provider calls over broad/sensitive scopes.
- No treating source count or a requested `last7` label as sufficient risk or
  permission evidence.
- No blocking prompt or background call when generic preload exceeds any part of
  its narrow standard envelope.
- No metadata-only candidate masquerading as semantic/proactive Quiet Recall.
- No model-controlled override of exclusions.
- No treating the opaque bridge exception as permission to read、send、show、log
  or persist an excluded note, and no traversal through generated、attachment or
  consecutive excluded nodes.
- No treating AI-generated notes as source by default.
- No one-click destructive wipe without grouped explanation.
- No vault-written runtime state by default.

## 15. Summary

Data Boundary System keeps PA's local-first promise concrete.

The intended product shape is:

- one shared exclusion policy
- one tightly bounded, local-only opaque topology exception that preserves all
  excluded content/identity/output/provider boundaries
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
