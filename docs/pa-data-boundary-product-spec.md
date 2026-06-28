# PA Data Boundary Product Spec

Updated: 2026-06-28

## Status

| Field | Value |
| --- | --- |
| Document type | Product spec / future implementation input |
| Status | Confirmed decision spec; implementation not started |
| Feature family | Data Boundary / Privacy / Local-first controls |
| Primary surfaces | Settings, Chat, Pagelet, Memory, Maintenance Review |
| Related research | [PA Agent AI insight research report](./pa-agent-ai-insight-research-report.md) |
| Related specs | [PA Product Information Architecture spec](./pa-product-information-architecture-spec.md), [Quick Capture and Micronote spec](./pa-quick-capture-micronote-product-spec.md), [Quiet Recall and Insight Timing spec](./pa-quiet-recall-insight-timing-product-spec.md), [Saved Insight and Insight Ledger spec](./pa-saved-insight-ledger-product-spec.md), [Scope Recap and Theme Summary spec](./pa-scope-recap-theme-summary-product-spec.md), [Memory Type Taxonomy spec](./pa-memory-type-taxonomy-product-spec.md), [Retrieval Habit Profile spec](./pa-retrieval-habit-profile-product-spec.md), [Context Pager spec](./pa-context-pager-product-spec.md), [Weekly Review spec](./pa-weekly-review-product-spec.md), [PA Active Vault Indexer spec](./pa-active-vault-indexer-product-spec.md), [Pagelet Trust Layer spec](./pagelet-trust-layer-product-spec.md), [Pagelet Maintenance Review spec](./pagelet-maintenance-review-product-spec.md), [Lightweight Graph Discovery spec](./pa-lightweight-graph-discovery-product-spec.md), [PA Eval Harness spec](./pa-eval-harness-product-spec.md) |
| Related runtime docs | [VSS local state plan](./vss-local-state-plan.md), [VSS SQLite/WASM architecture](./vss-sqlite-wasm-architecture.md) |

This spec defines PA's shared data boundary system. It is not current shipped
behavior.

The goal is to keep Chat, Pagelet, Memory, Maintenance, Active Vault Indexer,
Graph Discovery, and Eval aligned on what can be read, sent to providers,
stored locally, exported to the vault, and cleared by the user.

## Confirmed Decisions

| ID | Decision | Product consequence |
| --- | --- | --- |
| DB-D1 | Build one shared Data Boundary System. | Chat/Pagelet/Memory/Maintenance/Indexer/Graph use the same excluded scopes, provider disclosure, and local/cache/vault-artifact boundaries. |
| DB-D2 | User-visible shape is a lightweight `Data & Privacy Boundaries` settings area. | Users get one place to manage boundaries without a heavy privacy control center. |
| DB-D3 | Excluded folders/tags are global hard boundaries by default, with explicit per-run override. | A run may include an excluded scope only after user-visible one-time authorization. |
| DB-D4 | AI-generated notes are excluded by default, with configurable inclusion policy. | Prevents self-reference and summary drift while allowing user-confirmed generated artifacts to become sources. |
| DB-D5 | Data cleanup is unified and grouped by data type. | Cache, queues, graph state, replay, unconfirmed memory, and confirmed memory are cleared separately. |
| DB-D6 | Provider disclosure is first-use plus broad/sensitive/costly run disclosure. | Small scopes stay low-friction; wide or consequential runs show scope/provider/cost before continuing. |
| DB-D7 | Data Boundary needs its own spec. | Privacy and local-first behavior must be consistent across all PA surfaces. |

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
- Memory export/delete controls
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

Provider disclosure should happen:

- on first use of provider-backed note reading
- before broad/costly/sensitive runs
- before first Prepare/Update Memory
- before broad Pagelet review or weekly scan
- before Maintenance scan over broad scope
- before runs that generate Memory Candidates or Confirmed Memory
- when excluded/sensitive scopes are temporarily included

Disclosure should show:

- included scope
- excluded scope
- provider/model when relevant
- "note text may be sent to the configured AI provider"
- possible API credits/cost
- run / adjust / cancel

Small current-note or already-authorized low-risk runs should not repeat heavy
disclosure each time.

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
| Confirmed Memory | local store + Memory panel | user-visible, not vault-polluting by default |
| memory deletion markers | local store | text-free tombstones; clearable advanced cleanup |
| vault artifacts | Markdown notes after user action | searchable/syncable user-owned output |
| replay traces | local store by default | explainability/eval metadata; no private note text by default |

Markdown vault remains the source of truth for user notes. Local runtime state
must not create or update vault files by default.

## 9. Surface Requirements

| Surface | Data boundary behavior |
| --- | --- |
| Chat | honors exclusions; broad/sensitive questions use scope/provider disclosure; sources shown after answer |
| Pagelet | shows included/skipped sources; generated notes excluded by default; broad/weekly scans disclose provider scope |
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
- provider disclosure appears for broad/sensitive/costly runs
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
- Add broad/sensitive/costly run disclosure.
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
- replay metadata for boundary decisions

This gives PA room to become powerful without making privacy behavior scattered
or surprising.
