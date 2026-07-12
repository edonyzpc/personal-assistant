# PA Memory Control Center Development Plan

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-11

Product spec: [PA Memory Control Center Product Spec](../product/specs/pa-memory-control-center-product-spec.md)

SDD: [PA Memory Control Center SDD](./pa-memory-control-center-sdd.md)

Tracker: [PA Memory Control Center Development Tracker](./pa-memory-control-center-development-tracker.md)

## Status

| Field | Value |
| --- | --- |
| Status | Implementation, validation, and closeout complete |
| Iteration theme | Understand notes, make user understanding governable |
| Runtime implementation | Canonical Settings, local governance, migration/rollback, lifecycle, admission/use, and contextual routing implemented |
| Current safe scope | Handoff only; future feature expansion requires a new iteration |
| Blocking boundary | No runtime blocker; commit, push, and release were not requested or performed |

## Goal

Turn PA's fragmented note Memory, interaction-derived profile, Confirmed Memory,
and Memory settings into one low-burden, source-backed governance experience.

The iteration established a truthful hybrid read model before adding the
versioned device-local governance store and lifecycle actions. Final validation
separates isolated-profile Device A/B evidence, real-iPhone evidence, and the
unchanged product decision not to synchronize governed Memory automatically.

## Non-goals

- Cross-vault synthesis of note-derived understanding.
- Automatic cross-device synchronization.
- A standalone Memory tab.
- Import/export in the first runtime slice.
- VSS replacement or Markdown source-of-truth changes.
- Vault-write, network, or external-action authority.
- Folding the separate optimization batch into this iteration's commits.

## Current Baseline

| Pipeline | Current owner | Current persistence | Current product effect |
| --- | --- | --- | --- |
| Note Memory | `MemoryManager` + `VSS` | OPFS/IndexedDB local index | Retrieval for Chat |
| Vault Insights | `MemoryExtractionScheduler` + Type-C analyzer | Loaded derived snapshot with Data Boundary fingerprint | Typed read model and bounded agent context when current |
| User profile | Governed Type-A source + serialized Profile governance port | Device-local governance plus recoverable Profile projection | Governed context, inspection, correction, pause, and Forget |
| Durable claims | `MemoryGovernanceRepository` + coordinators | Versioned device-local IndexedDB partitioned by opaque vault key | Canonical Settings governance and bounded context use |
| Memory Candidate/conflict Queue | Composite local Review Queue repository | Device-local governance; non-Memory items remain settings-compatible | Effect-based admission and candidate review |
| Policy, events, recovery | Governance repository | Device-local keyed policy, events, undo, markers, operations, migration journal | Admission, Recent changes, rollback, finalization, and retry |
| Legacy compatibility | Raw `data.json` slices behind compatibility barrier | Preserved until explicit verified finalization | Rollback source only; not the governed reader after cutover |

These owners are now integrated without collapsing Markdown/VSS, derived
observations, durable claims, and compatibility data into one false source of
truth.

## Iteration Scope

### Must

1. Establish the product spec, development plan, SDD, and tracker.
2. Reconcile North Star and active Memory specs after the existing dirty-diff
   ownership boundary is resolved.
3. Build a read-only hybrid Memory control-center projection.
4. Add a Settings Overview that performs no provider call, note write, index
   preparation, or data migration.
5. Make scope, source, effect, status, time, and device boundary truthful.
6. Keep the now-closed Forget copy/runtime mismatch covered before offering or
   changing canonical Forget behavior.
7. Add a versioned device-local governance store and a multi-device-safe legacy
   compatibility/cutover path.
8. Implement lifecycle actions, change events, Undo, and the effect-based
   admission policy before calling Settings the complete canonical surface.
9. Add an actual governed-use projection so eligible durable claims affect
   answers and Pause/Forget can prove exclusion rather than operate on unused
   state.
10. Preserve current effective behavior at migration: Type-A remains
    vault-scoped and used, while legacy Confirmed Memory remains
    `stored_not_in_use` until admitted by the new policy.

### Should

1. Route Pagelet/Chat/Recall explanations and corrections to Settings.
2. Remove internal taxonomy chips from ordinary Memory governance UI.

### Could

1. Add lightweight dogfood instrumentation for inspection and undo timing.
2. Add an advanced diagnostic view of internal types and migration state.
3. Add a local export preview after the schema proves stable.

### Defer

1. Cross-vault understanding.
2. Automatic synchronization.
3. Bulk editing and a standalone Memory destination.
4. Replace-mode import.
5. Any Memory-derived action permission.

## Phase Roadmap

### Phase 0: Product Source-Of-Truth Alignment

Status: complete.

Deliverables:

- product spec, plan, SDD, and tracker;
- effect/risk North Star wording;
- supersession notes in Product IA, Trust Layer, taxonomy, Data Boundary, and
  Retrieval Habit specs;
- active links in `docs/index.md`, `docs/backlog.md`, and
  `docs/development-roadmap.md`;
- historical 30-confirmation decisions retained as history, not rewritten as
  the new general rule.

Exit gate:

- current docs identify one canonical Memory product contract;
- no active doc requires a standalone Memory panel or blanket confirmation as
  the current target;
- no runtime file is changed while the overlapping optimization diff remains
  separately owned.

### Phase 1: Read-Only Hybrid Overview

Status: complete and promoted into the canonical Settings surface. The
side-effect-free inspection contract remains enforced after promotion.

Deliverables:

- a pure read-model builder over note Memory status, user-profile state, and
  Confirmed Memory, plus an already-loaded Type-C Vault Insights snapshot;
- a read-only `Memory and personalization` Settings Overview with progressive
  disclosure;
- non-creating Profile and VSS status peeks that represent unhydrated state as
  `unknown` rather than `unprepared`;
- user-facing source, scope, effect, lifecycle, time, and device-boundary
  labels;
- focused unit tests and Settings DOM tests.

Rules:

- no new persistent schema;
- no automatic preparation or provider call;
- no IndexedDB schema creation, VSS initialization, service creation, settings
  save, or other persistent mutation;
- no action is shown unless its complete effect is implemented;
- recent confirmations are not labeled Recent changes;
- internal taxonomy is not ordinary UI;
- the Overview is labeled and tracked as transitional during this phase and
  remains gated until complete user-facing capability exists. That promotion
  gate has since passed; canonical Settings status is recorded above.

Exit gate:

- overview renders accurately for empty, disabled, unprepared, prepared,
  profile-only, record-only, mixed, stale, and malformed-source states;
- dedicated Settings-window smoke confirms the real surface;
- no P0-P2 review findings remain.

### Phase 2: Versioned Device-Local Governance Store

Status: complete. Repository, migration, rollback, finalization, same-device
multi-vault, isolated-profile non-inheritance, and Device A/B legacy first-start
behavior all have automated or runtime evidence.

Deliverables:

- versioned schema for claims, revisions, Memory Candidate/conflict queue items,
  projection links, change events, undo snapshots, suppression markers,
  pending operations, admission/trust policy, migration state, and rollback
  deltas/payload entries, with type, sensitivity, and vault applicability
  preserved;
- transactionally consistent record/event/snapshot writes;
- explicit vault-scoped and same-device collaboration partitions;
- a device-local guarantee independent of Obsidian vault-file sync;
- two-phase, idempotent migration from raw `data.json` Memory slices before
  settings normalization can discard or overwrite invalid entries;
- cross-connection revision/invalidation behavior for two vault windows on the
  same device, with policy and migration cursors partitioned per vault;
- deterministic Type-A adoption where the governance repository becomes the
  prompt authority and ProfileStore becomes a recoverable derived projection;
  adoption preserves conversation provenance and uses a deterministic positive
  low-risk classifier, otherwise remaining fail-closed on the legacy path;
- item-level legacy Review Queue passthrough that preserves live non-Memory
  mutations during compatibility.

Migration sequence:

1. Capture and hash raw governance, Memory Candidate, trust-count, and pause
   slices before `mergeLoadedSettings` or any settings save.
2. Parse accepted and rejected entries with redacted diagnostics; preserve raw
   legacy slices behind a passthrough barrier until finalization.
3. Write claims, revisions, Memory Candidate/conflict items, exact projection links,
   and policy state with deterministic migration IDs.
4. Verify raw/accepted/rejected counts, checksum, link integrity, scope, and
   readability.
5. Persist a local cutover marker, rollback payload, and cutover sequence.
6. Switch readers only after readback verification and journal every
   post-cutover mutation as a replayable migration delta.
7. Keep every legacy record in its original vault partition; never promote it
   to same-device collaboration scope based on type or wording.
8. Do not automatically clear potentially synchronized legacy `data.json`
   content after one device cuts over. Provide a compatibility period and an
   explicit finalization step that previews cross-device impact.
9. Rollback pauses mutations, verifies the base payload, replays every delta,
   reapplies text-free Forget overlays, writes and reads back the complete
   legacy projection, then switches readers.
10. If a new lifecycle cannot be represented safely in rollback, keep the
    local reader active rather than dropping or reviving data.

Exit gate:

- crash recovery is tested at every migration boundary;
- two-vault isolation and same-device sharing are verified separately from a
  second-device or isolated-profile non-inheritance test;
- rollback is documented and tested;
- post-cutover additions, corrections, lifecycle changes, and policy changes
  survive rollback;
- no private content remains in legacy state after explicit final cleanup;
- UI copy distinguishes device-local governed state from retained legacy
  compatibility data throughout migration and finalization.

### Phase 3: Lifecycle Actions And Recent Changes

Status: implemented with focused/full automated evidence. Actual desktop
confirmation of destructive Forget/finalization flows remains in the Phase 4
smoke gate.

Deliverables:

- Correct with user-authoritative revision lineage;
- immutable Type-A profile record IDs and exact cross-pipeline projection
  links; no fuzzy text matching;
- Pause use with an explicit reversible state;
- Forget with idempotent, fail-closed, resumable linked-content cleanup and a
  consumed text-free suppression marker;
- change events and seven-day Undo snapshots;
- Recent changes without badge, pending, or queue semantics;
- an effect-based admission policy that can return ephemeral, silent durable,
  prior-review, or reject decisions;
- no silent durable admission until change events and the required recovery
  path are available;
- a durable pending-operation state machine that blocks use immediately and
  resumes linked cleanup after restart;
- a bounded external-operation timeout so a stalled profile or compatibility
  store leaves Forget/finalization retryable instead of blocking plugin startup.

Exit gate:

- transition matrix, failure injection, seven-day boundaries, source changes,
  and suppression invalidation pass;
- Forget removes old content from governance, Review Queue, profile injection,
  every exact Memory/projection copy, undo snapshots, and migration rollback
  payloads without silently rewriting source notes or visible chat history;
- concurrent Type-A extraction cannot restore a corrected, paused, or forgotten
  profile projection;
- UI copy describes only effects the runtime proves.

### Phase 4: Contextual Integration

Status: complete. Desktop contextual-boundary/lifecycle, post-timeout actual
Forget/finalization, governed Chat reopen, AI Insights fail-closed, and
real-device iOS smoke pass.

Deliverables:

- Pagelet, Chat, Recall, and AI Insights show compact source/effect traces;
- a governed-use projection selects active claims by scope, effect, Data
  Boundary, lifecycle, and suppression state before injecting bounded context;
- contextual correction and deep links open the exact Settings detail;
- Pagelet remains the Memory Candidate review surface without becoming the
  complete governance destination;
- generic `Remove` terminology is replaced with lifecycle-accurate actions.

Exit gate:

- contextual surfaces and Settings agree on record state;
- back/close/reopen and Obsidian reload preserve routing and state;
- narrow desktop and real-device iOS smoke run when mobile UI is affected.

### Phase 5: Closeout

Status: complete. The 155-suite / 2877-test gate, latest desktop reload and
destructive-confirmation smoke, isolated Device A/B evidence, iCloud hash and
restore checks, iOS Mirroring/Inspector smoke, final review/fix/re-review, and tracker closure
all pass.

Deliverables:

- full review and follow-up triage;
- focused and full validation;
- Obsidian Settings/Pagelet/Chat smoke;
- tracker, TODO, roadmap, and dependent specs reconciled;
- future export/import and cross-vault work explicitly deferred.

Exit gate:

- no unresolved P0-P2 findings without explicit deferral;
- docs and runtime describe the same product;
- worktree ownership and commit boundaries are explicit.

## Dependency Map

| Dependency | Relationship |
| --- | --- |
| Separate optimization batch | Must be isolated or committed by its owner before overlapping runtime work |
| Product North Star | Must adopt effect/risk governance without embedding a numeric threshold |
| Product IA | Standalone Memory panel assumption is superseded |
| Trust Layer | Evidence/Memory distinction remains; governance routes to Settings |
| Memory taxonomy | Remains internal policy and validation metadata |
| Data Boundary | Controls source eligibility, provider disclosure, deletion, and export |
| Type-A profile extraction | Must become visible and governable without losing source/authority |
| Type-C Vault Insights | Remains current-vault derived observation; Overview reads only an already-loaded snapshot |
| MemoryManager/VSS | Remains note Memory preparation and retrieval owner |
| Review Queue | Candidate workflow only; not canonical active Memory state |
| Settings | Canonical complete governance surface and dedicated-window smoke target |
| Pagelet | Contextual candidate review and source-backed handoff |
| PA Agent context | Must consume eligible governed claims and enforce pause/suppression before prompt projection |

## Risk Table

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Memory sources appear unified but remain behaviorally independent | User correction or Forget does not affect actual prompt behavior | Closed by typed read model, governed-use consumer, exact lifecycle coordinator, and linked projection recovery |
| Forget promise exceeds runtime | Private content remains or is relearned | Closed by atomic pending state, bounded external I/O, exact cleanup, suppression, redaction, automated restart coverage, and repeated actual confirmation |
| Legacy `data.json` is confused with device-local governed state | Device-local claim is false | Closed by device IndexedDB ownership, explicit compatibility UI, isolated-profile non-inheritance, and Device A/B first-start evidence |
| Migration loses or duplicates durable claims | Trust and data loss | Closed by deterministic IDs, checksum, phase recovery, repeat-run tests, and rollback |
| Cutover rollback drops later writes | Data loss or forgotten content revival | Closed by per-run delta/payload journal, overlays, readback, action round-trip, and concurrent-vault tests |
| Review Queue Memory state remains syncable | Device-local claim is incomplete | Closed by composite local Memory Candidate/conflict persistence with non-Memory passthrough |
| Forget cannot resume or identify copies | Private content remains or unrelated profile data is removed | Closed by text-free pending operations, immutable links, startup/manual/background retry |
| Type-A extraction races lifecycle actions | Corrected or forgotten content reappears | Closed by serialized Profile governance and durable projection outbox |
| Governed claims remain unused | Pause/Forget pass vacuously and preferences never affect answers | Closed by bounded governed-use projection and positive/fail-closed prompt tests |
| Overview triggers preparation/provider cost | Surprise cost and privacy impact | Read-only status APIs; no implicit initialization or refresh |
| Internal taxonomy leaks into UI | Users manage ontology instead of meaning | Project only source/scope/effect/status/time |
| Recent changes becomes another inbox | Management burden | No badges, pending state, or completion metric |
| Dirty worktree mixes iteration ownership | Rollback and verification evidence become invalid | Preserve all existing changes; this closeout performs no staging, commit, push, or release |

## Validation Strategy

Per runtime slice:

```bash
npm test -- --runInBand <focused suites>
npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

Runtime/UI completion uses `make deploy`, the real repo-local test vault, and
the dedicated Settings window. Mobile-sensitive changes additionally use the
real-device iOS smoke workflow.

Review lanes:

- product contract and cognitive load;
- state, migration, concurrency, and rollback;
- privacy, Data Boundary, and provider cost;
- Settings/Pagelet/Chat lifecycle, accessibility, and mobile;
- tests, docs, and compatibility.

## Worktree And Commit Boundary

The implementation and documentation remain an uncommitted multi-file
worktree. The user authorized the Memory control-center iteration but has not
authorized this closeout task to stage, commit, push, release, rewrite, stash,
or reset any part of it. Every documentation edit must preserve existing code,
tests, and unrelated work.

## User Decisions

No additional product decision blocks this plan. Further user approval is
needed only for scope expansion or for external actions such as publishing,
Linear disclosure of private repo details, or changing ownership of the
existing uncommitted optimization batch.
