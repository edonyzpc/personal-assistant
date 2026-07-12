# PA Memory Control Center Development Tracker

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-11

Product spec: [PA Memory Control Center Product Spec](../product/specs/pa-memory-control-center-product-spec.md)

Plan: [PA Memory Control Center Development Plan](./pa-memory-control-center-development-plan.md)

SDD: [PA Memory Control Center SDD](./pa-memory-control-center-sdd.md)

## Status Legend

| Mark | Meaning |
| --- | --- |
| `[ ]` | Todo |
| `[~]` | In progress |
| `[x]` | Done |
| `[!]` | Blocked |

## Overall Status

| Field | Value |
| --- | --- |
| Iteration | Implementation and validation complete |
| Current phase | P6 closeout |
| Runtime | Canonical Settings control center, governed persistence, lifecycle actions, admission/use projection, and contextual routing implemented |
| Product decisions | Complete |
| Remaining boundary | No open implementation or validation gate; commit, push, and release remain outside this task |
| Linear sync | Not performed; external disclosure was rejected by safety policy |

## Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| P0 Product alignment | `[x]` | Canonical authority and active-spec supersession reconciled |
| P1 SDD | `[x]` | Iterative product/runtime/data Gates closed with no P0-P2 |
| P2 Read-only overview | `[x]` | Focused/full gates, three-lane review, and real Settings smoke passed |
| P3 Versioned local store | `[x]` | Isolated-profile Device A/B evidence closed P3.12-13 without leaving synthetic state |
| P4 Lifecycle + contextual integration | `[x]` | Post-timeout actual Forget/finalization, contextual runtime, and real-device iOS smoke passed |
| P5 Review + Smoke | `[x]` | Automated, desktop, isolated-profile, iCloud, iOS, and final Agent Team gates passed |
| P6 Close | `[x]` | Active docs, tracker, TODO, roadmap, risks, and verification evidence reconciled |

## P0: Product Alignment

| ID | Task | Status | Evidence / blocker |
| --- | --- | --- | --- |
| P0.1 | Capture approved product decisions | `[x]` | `pa-memory-control-center-optimization-plan.md` |
| P0.2 | Create canonical product spec | `[x]` | `pa-memory-control-center-product-spec.md` |
| P0.3 | Create development plan | `[x]` | `pa-memory-control-center-development-plan.md` |
| P0.4 | Reconcile North Star to effect/risk governance | `[x]` | Blanket durable confirmation replaced by approved effect/risk rule |
| P0.5 | Add supersession notes to Product IA, Trust Layer, taxonomy, Data Boundary, and Retrieval Habit specs | `[x]` | Active ownership clarified with links to canonical spec |
| P0.6 | Update index, TODO, and roadmap from Future to Active | `[x]` | Current iteration linked from all active entry points |
| P0.7 | Preserve historical 30-confirmation decisions without treating them as current North Star | `[x]` | Retained only as versioned legacy migration policy |

Exit gate: all active docs point to the canonical product spec and contain no
unqualified contradictory Memory-surface or blanket-confirmation rule.

## P1: SDD And Dependency Audit

| ID | Task | Status | Evidence / blocker |
| --- | --- | --- | --- |
| P1.1 | Map note Memory, Type-A profile, Confirmed Memory, Review Queue, and Settings | `[x]` | Current source audit on 2026-07-10 |
| P1.2 | Verify existing method/type names | `[x]` | `rg` checks recorded in SDD symbol table |
| P1.3 | Define hybrid read model | `[x]` | Typed Type-C observation, aggregate provenance, truthful unknown states |
| P1.4 | Define versioned local store and migration | `[x]` | Complete schema, raw capture, per-vault migration, typed rollback and Queue compatibility |
| P1.5 | Define lifecycle coordinator and suppression contract | `[x]` | Exact lineage, governed Type-A, pending Forget, real use consumer |
| P1.6 | Agent Team pre-draft product/runtime/data audit | `[x]` | Three read-only lanes completed; findings reflected in docs |
| P1.7 | Agent Team post-draft SDD review | `[x]` | Historical PASS superseded by the 2026-07-10 independent Gate |
| P1.8 | Resolve all P0-P2 SDD findings | `[x]` | Four review/fix loops closed all product/runtime/data findings |
| P1.9 | Add typed Type-C observation source | `[x]` | Aggregate provenance, representative refs, Data Boundary fingerprint and invalidation |
| P1.10 | Define governed-use projection and legacy effect preservation | `[x]` | Claim policy fields, current scope, Type-A/Type-C compatibility cutover |
| P1.11 | Define serialized Type-A governance | `[x]` | Persisted provenance, fail-closed classifier, immutable IDs, durable Profile operations |
| P1.12 | Complete raw Memory migration inputs | `[x]` | Raw capture, item-level Queue merge, rejected diagnostics, cumulative legacy policy |
| P1.13 | Complete Forget journal and exact lineage | `[x]` | Pending operation, exact projection links, no fuzzy cleanup |
| P1.14 | Define post-cutover delta-safe rollback | `[x]` | Per-vault run state, typed payload/checksum, deltas, overlays, readback |
| P1.15 | Define non-creating Profile/VSS adapters | `[x]` | `unknown` hydration and no IndexedDB/VSS initialization |
| P1.16 | Define explicit same-device scope and multi-instance consistency | `[x]` | Per-vault state, user scope action, transaction/revision/subscription contract |
| P1.17 | Define canonical Settings nav and promotion gate | `[x]` | `memory-personalization`; initial gated milestone later promoted after lifecycle/use evidence |
| P1.18 | Repeat independent product/runtime/data Gate | `[x]` | Three final lanes PASS; no remaining P0-P2 |

Exit gate: post-draft review is clean, all current symbols are re-grepped against
a stable baseline, and the user-approved scope requires no new product choice.

## P2: Read-Only Hybrid Overview

| ID | Task | Status | Required evidence |
| --- | --- | --- | --- |
| P2.0 | Re-grep all existing symbols against the stable post-optimization baseline | `[x]` | 2026-07-10 source/test symbol audit confirmed current owners and new adapter names |
| P2.1 | Add pure `MemoryControlCenter` read-model types and builder | `[x]` | Pure unit tests pass |
| P2.2 | Add side-effect-free `MemoryManager`/VSS status snapshots | `[x]` | Cold `unknown` and no-initialize tests pass |
| P2.3 | Add non-creating existing Profile reader | `[x]` | 11 reader lifecycle tests pass |
| P2.4 | Add clone-safe Scheduler Type-A/Type-C snapshot accessors | `[x]` | Boundary-race, stale, error, clone tests pass |
| P2.5 | Add read-only PluginManager aggregator | `[x]` | Cached-source/no-constructor/no-settings-mutation tests pass |
| P2.6 | Add `memory-personalization` nav and render Overview/details | `[x]` | Settings DOM, locale, collapse, async generation and responsive CSS verified |
| P2.7 | Hide internal taxonomy in ordinary control-center UI | `[x]` | DOM assertions and real-window inspection pass |
| P2.8 | Explain current vault/device boundary accurately | `[x]` | Compatibility copy test and product review pass |
| P2.9 | Run focused gate and independent review | `[x]` | 385 focused tests; three-lane review/fix/re-review PASS; type/diff/community scans pass |
| P2.10 | Deploy and smoke dedicated Settings window | `[x]` | `make deploy`; real window overview/detail/narrow smoke; screenshots in `/private/tmp` |
| P2.11 | Keep intermediate Overview gated until promotion evidence exists | `[x]` | Initial Debug gate was honored; it was removed when Settings became the canonical lifecycle-capable surface |
| P2.12 | Complete read-only value dogfood journey | `[x]` | Real detail path shows source, authority, scope, effect, status, time; no actions |

Exit gate: the Overview is truthful, read-only, ignorable, and causes no
provider call, note write, index work, or persistent mutation.

## P3: Versioned Device-Local Governance Store

| ID | Task | Status | Required evidence |
| --- | --- | --- | --- |
| P3.1 | Refactor current persistence behind a repository interface | `[x]` | Callback/device repositories and behavior-equivalence coverage |
| P3.2 | Capture raw legacy slices and establish passthrough barrier | `[x]` | Item-level Queue merge, settings-save/restart/conflict/malformed-input coverage |
| P3.3 | Add complete versioned schema and transactions | `[x]` | V1 claims/revisions/links/events/snapshots/markers/operations plus keyed policy/migration/delta/payload state |
| P3.4 | Add composite device-local Memory Candidate/conflict persistence | `[x]` | Memory items use the local repository while live non-Memory Queue mutations remain compatible |
| P3.5 | Migrate cumulative legacy count and pause state per vault | `[x]` | Clamp, 29/30 threshold, count, pause, and restart tests |
| P3.6 | Implement deterministic import, Type-A adoption, and exact links | `[x]` | Deterministic IDs/checksums, exact lineage, projection outbox, and repeat-run tests |
| P3.7 | Preserve legacy effective behavior at cutover | `[x]` | Type-A/Type-C cutover coverage; legacy Confirmed records stay `stored_not_in_use` |
| P3.8 | Add per-vault cutover sequence and migration delta journal | `[x]` | Typed delta and payload/checksum commit atomically per migration run |
| P3.9 | Add replay-safe seven-day rollback | `[x]` | Crash/checksum/readback/Forget overlay plus real Pause -> Resume -> Change Scope coordinator round-trip tests |
| P3.10 | Verify vault partition and same-device collaboration feasibility | `[x]` | Desktop probe used the same device DB with different opaque vault keys; cleanup reached sequence 27 and vault-local claims remained isolated |
| P3.11 | Add cross-connection revision and invalidation | `[x]` | Desktop probe: sequence 24 -> 26 concurrent CAS, one writer retried with `attempts=2`, and both instances observed both writes; automated close/versionchange/stale-cache tests pass |
| P3.12 | Verify second-device non-inheritance independently | `[x]` | Two clean `/private/tmp` Obsidian profiles: Device A local correction produced one delta; Device B first start retained the original summary with zero deltas and a distinct opaque key |
| P3.13 | Keep legacy state compatible until explicit finalization | `[x]` | A/B imported the same `legacy-v1:1df03d...` source in compatibility; both synchronized `data.json` copies retained exact SHA-256 `33c8f35e...` with one record and one queue item |
| P3.14 | Add explicit finalization before legacy cleanup | `[x]` | Preview/token, restore-before-switch, failure/restart, expiry, and finalization tests; actual confirmation smoke is recorded under P4.14 |
| P3.15 | Review privacy, migration, and compatibility | `[x]` | Phase-scoped and final P5 review/fix/re-review closed all P0-P2 findings |

Exit gate closed: same-device vault isolation, independent-profile
non-inheritance, and Device A cutover -> synchronized legacy payload -> Device B
first-start behavior are all observed. Test profiles and vaults were removed.

## P4: Lifecycle And Contextual Integration

| ID | Task | Status | Required evidence |
| --- | --- | --- | --- |
| P4.1 | Add governed-use projection and prompt integration | `[x]` | Positive bounded-context coverage plus scope/Data Boundary/pause/suppression exclusion |
| P4.2 | Add immutable Type-A IDs and serialized Profile governance port | `[x]` | Extraction-in-flight, cache, failure, projection-outbox, and restart coverage |
| P4.3 | Route Type-A and Memory Candidates through effect admission | `[x]` | Four decisions and independent negative tests for every silent-durable prerequisite |
| P4.4 | Implement Correct with user-authoritative revision | `[x]` | Authority, exact lineage, suppression, conflict, undo, and prompt-effect tests |
| P4.5 | Implement real Pause use / Resume use | `[x]` | Actual governed-use exclusion/restoration and rollback round-trip coverage |
| P4.6 | Implement change events, change-scope, and seven-day Undo | `[x]` | Explicit device scope, transition, retention-boundary, timer, and GC tests |
| P4.7 | Consume suppression markers in admission and use | `[x]` | Admission/use both consume exact source/rule markers; invalidation tests pass |
| P4.8 | Implement durable pending Forget coordinator | `[x]` | Atomic block, resumable phases, bootstrap/manual/background exponential retry, single-timer, and unload cleanup tests |
| P4.9 | Perform exact linked cleanup without fuzzy matching | `[x]` | Governance, Memory Queue, Type-A, compatibility, and projection copies use immutable links |
| P4.10 | Redact Forget content from undo, deltas, and rollback payloads | `[x]` | Failure/restart/rollback tests prove no content recovery after Forget |
| P4.11 | Render Recent changes without queue semantics | `[x]` | Event-only DOM, no badge/completion debt, redacted Forget history, seven-day GC |
| P4.12 | Replace generic Remove and taxonomy-first Pagelet UI | `[x]` | Lifecycle-specific locale/DOM copy and product review |
| P4.13 | Add exact deep links and source/effect traces | `[x]` | Routing/reload tests plus desktop contextual-boundary probe keep Settings canonical |
| P4.14 | Run review/fix loop and UI/mobile smoke | `[x]` | Post-timeout actual Forget and finalization passed on the synthetic desktop vault; iPhone Mirroring plus Safari Web Inspector passed layout, reload, resume, mode, safety, and console checks |

Exit gate closed. The first destructive smoke exposed an unbounded external-I/O
wait; the bounded timeout repair passed the full automated gate and the repeated
real confirmation paths. iOS loaded the current iCloud build and passed visual
and Inspector evidence without destructive actions.

## P5: Final Review And Smoke

| Lane | Status | Evidence |
| --- | --- | --- |
| Functional state, concurrency, migration | `[x]` | Timeout repair, actual finalization, A/B first-start, non-inheritance, and cleanup evidence pass |
| Product contract and low-burden UX | `[x]` | Final product lane closed prior findings; visible-chat Forget boundary confirmed and copy/spec updated |
| Privacy, Data Boundary, provider cost | `[x]` | Raw/API/rehydrated/DOM path redaction, pending AI Insights fail-closed, unchanged notes, and zero provider calls pass |
| Obsidian/community lifecycle | `[x]` | Full gate/community scan, repo-local reload, iCloud hash match, iOS reload/resume, and zero captured errors pass |
| Settings/Pagelet/Chat accessibility and mobile | `[x]` | Desktop contextual surfaces plus iOS single-column/no-overflow and eight 44px action controls pass |
| Tests, docs, compatibility, maintainability | `[x]` | 155 suites / 2877 tests, docs reconciliation, and final whole-iteration Agent Team review/fix/re-review pass |
| Repo-local Obsidian smoke | `[x]` | Post-timeout Forget/finalization, governed Chat reopen, AI Insights fail-closed, and runtime error checks pass |
| Real-device iOS smoke if mobile surfaces changed | `[x]` | iPhone Mirroring and Safari Inspector observed current iCloud build on iPhone 15; reload, resume, DOM/CSS, state, and errors pass |

## Verification Log

| Date | Check | Result | Notes |
| --- | --- | --- | --- |
| 2026-07-10 | Pre-draft Agent Team product audit | PASS_WITH_FINDINGS | No new user decision; identified doc conflicts |
| 2026-07-10 | Pre-draft Agent Team runtime audit | PASS_WITH_BOUNDARY | Optimization batch complete but uncommitted; runtime collision zone mapped |
| 2026-07-10 | Pre-draft Agent Team data/test audit | PASS_WITH_BLOCKERS | Forget semantics, device locality, multi-pipeline governance, schema gaps |
| 2026-07-10 | Existing optimization evidence read | PASS | Separate batch reports 137 suites / 2351 tests and app smoke; not rerun or claimed by this iteration |
| 2026-07-10 | Post-draft Agent Team SDD review | PASS | Three lanes; no remaining actionable P0-P2 |
| 2026-07-10 | New docs whitespace and repository diff check | PASS | No trailing whitespace; `git diff --check` exit 0 |
| 2026-07-10 | Independent Agent Team design Gate | FAIL_WITH_FINDINGS | Later evidence supersedes the historical PASS; nine product/runtime/data gaps reopened |
| 2026-07-10 | Review-followup decision triage | PASS | No new user decision; all findings fit approved product direction |
| 2026-07-10 | SDD/schema repair | PASS | Type-C, actual-use, Type-A, migration, Forget, rollback, read-only, multi-instance, and Settings contracts were reconciled before implementation |
| 2026-07-10 | Second independent design Gate | FAIL_WITH_FINDINGS | Deeper per-vault state, rollback payload, Type-A authority, queue merge, aggregate provenance, and use-compatibility gaps reopened |
| 2026-07-10 | Final iterative design Gate | PASS | Product, runtime/dependency, and data/test lanes report no remaining P0-P2 |
| 2026-07-10 | Active-doc links, whitespace, and diff checks | PASS | 15 local docs link targets exist; no trailing whitespace; `git diff --check` clean |
| 2026-07-10 | P2 stable-baseline symbol re-grep | PASS | MemoryManager/VSS/Scheduler/Profile/Plugin/Settings and legacy governance/queue owners confirmed before Phase B integration |
| 2026-07-10 | P2 focused implementation gate | PASS | 7 suites / 385 tests, TypeScript, diff check, generated CSS, community DOM scan |
| 2026-07-10 | P2 Agent Team review/fix/re-review | PASS | Product/runtime/test lanes closed all P1/P2 findings without new product decisions |
| 2026-07-10 | P2 full deploy gate | PASS | `make deploy`: 139 suites / 2393 tests, lint, build, assets deployed |
| 2026-07-10 | P2 real Settings smoke | PASS | Overview, progressive details, nav, authority/source/scope/effect, narrow layout; `data.json` hash unchanged |
| 2026-07-11 | P3/P4 full automated gate snapshot | SUPERSEDED_PASS | 155 suites / 2851 tests passed at that snapshot; the post-timeout 2874-test gate below supersedes it |
| 2026-07-11 | `make deploy` to repo-local test vault | PASS | Plugin assets built and deployed successfully; this is desktop evidence, not iOS evidence |
| 2026-07-11 | Desktop canonical Settings lifecycle/hash smoke | PASS | Dedicated Settings window opened, navigated, closed, and reopened with canonical `Memory and personalization`; read-only inspection preserved the persisted-data hash |
| 2026-07-11 | Desktop contextual-surface boundary smoke | PASS | Contextual routing reached the exact Settings governance target without creating a second complete governance surface |
| 2026-07-11 | Desktop same-device multi-vault probe | PASS | Same DB, different opaque keys; concurrent CAS advanced sequence 24 -> 26, one side retried with `attempts=2`, both instances observed both writes, cleanup advanced to 27, and vault claims remained isolated |
| 2026-07-11 | P3.9/P3.11 focused rollback evidence | PASS | Real cutover Pause -> Resume -> Change Scope rollback round-trip and concurrent two-vault rollback isolation; related 3 suites / 62 tests pass |
| 2026-07-11 | Final automated and deploy gate snapshot | SUPERSEDED_PASS | 155 suites / 2867 tests passed at that snapshot; the post-timeout 2874-test gate below supersedes it |
| 2026-07-11 | Final contextual state/reload smoke | PASS | Live and twice-reloaded Pagelet retain only exact claim ID in workspace state; Correct + exact Settings remain, Pause/Resume/Forget/Recent stay absent, and title/path are not persisted |
| 2026-07-11 | Final two-vault/runtime-error smoke | PASS | Same device DB and distinct opaque keys remain; synthetic claim stays isolated, both vaults report no captured errors, and source-note plus legacy `data.json` hashes remain unchanged |
| 2026-07-11 | Actual synthetic Forget confirmation | FAIL_WITH_FINDING | Confirmation executed, but a non-settling compatibility-store operation kept Settings/bootstrap waiting; source note and legacy `data.json` hashes remained unchanged |
| 2026-07-11 | External-operation timeout repair | PASS_AUTOMATED | Forget/profile/legacy and finalization operations are bounded; stalled-write tests prove redacted retryable pending state and bootstrap readiness |
| 2026-07-11 | Post-timeout full automated and deploy gate | SUPERSEDED_PASS | 155 suites / 2874 tests, TypeScript, lint, build, diff check, community DOM scan, and `make deploy` passed; the final 2877-test gate below supersedes it |
| 2026-07-11 | Post-timeout actual synthetic Forget | PASS | Bootstrap recovered to `ready`; the exact claim became a content-free tombstone, pending operations reached zero, Recent changes stayed redacted, source-note SHA-256 `236414c0...` and `data.json` SHA-256 `148667ef...` remained unchanged, and Obsidian reported no errors |
| 2026-07-11 | Actual compatibility finalization confirmation | PASS | The warning explicitly stated cross-device impact and unchanged notes; current partition reached `finalized`, rollback payloads reached zero, legacy slices were absent, and source/data hashes remained unchanged |
| 2026-07-11 | Governed Chat persistence and reopen | PASS | Production `recordTurn` plus raw IndexedDB/API/rehydrated/DOM checks removed the exact source path while preserving claim ID; reopened UI rendered one Saved-understanding link and zero source summaries; the synthetic conversation was deleted and the active pointer restored |
| 2026-07-11 | AI Insights pending Forget fail-closed | PASS | A synchronous in-memory pending state and stale Profile sentinel opened the real modal; the pending claim was excluded, stale text was absent, the empty state rendered, state/scheduler/gate were restored, and no runtime error was captured |
| 2026-07-11 | iCloud build deploy and restoration | PASS | `make deploy-icloud` passed 155 suites / 2874 tests, lint, and build; iCloud `main.js`/`styles.css` matched `b4873753...` / `363f48d8...`; temporary legacy injection was read back exactly, then original `data.json` SHA-256 `00b97bc3...`, mode `0600`, and zero sentinels were restored |
| 2026-07-11 | P3.12/P3.13 isolated Device A/B smoke | PASS | Clean profiles imported the same compatibility source hash; A local correction created one device delta, B first start inherited none, opaque keys differed, and both synchronized legacy files remained byte-identical before all temporary profiles/vaults were removed |
| 2026-07-11 | Real-device iOS smoke | PASS | iPhone 15 loaded and reloaded the iCloud build via iPhone Mirroring; Safari Inspector reported `ready`, supported `legacy_threshold` compatibility, zero pending/synthetic state, 430px viewport with no horizontal overflow, one 364px card column, eight visible 44px controls, and no Console error rows; the original note view was restored |
| 2026-07-11 | Final whole-iteration Agent Team review | FAIL_WITH_FINDINGS | Runtime lane found delayed Forget recovery/applicability redaction, a timeout that could leave the global settings-write tail pending, and same-label governed Chat history route collapse; product/docs lane found a stale North Star snapshot label and an overbroad iOS evidence sentence |
| 2026-07-11 | Initial final-review fixes and focused regression | PARTIAL_PASS | The first three findings were repaired: Forget recovery/applicability redaction, settings-tail timeout release, and exact-claim canonical history routing; later re-review reopened one deeper pre-upgrade/local-Queue Forget gap |
| 2026-07-11 | Initial post-review full automated and deploy gate | SUPERSEDED_PASS | `make deploy`: 155 suites / 2875 tests, TypeScript, lint, production build, and repo-local deployment passed before the deeper Forget recovery finding was reported |
| 2026-07-11 | Runtime/validation re-review | FAIL_WITH_FINDING | A pre-upgrade `claim_redacted` or `linked_copies_redacted` operation could retry external I/O before sanitizing old applicability/recovery, and reversed target order could leave a linked local Memory Queue item readable |
| 2026-07-11 | Second Forget-boundary repair and focused gate | PASS | All persisted phases now run idempotent local redaction before external I/O; linked local Queue targets are removed/redacted in the same transaction; reversed order and two pre-upgrade permanent-timeout cases pass in 23 coordinator tests and 3 suites / 173 tests |
| 2026-07-11 | Pre-final deploy gate | FAIL_AT_BUILD | 155 suites / 2877 tests and lint passed; TypeScript caught two callback-narrowing errors before build/deploy, which were fixed by retaining the exact Queue item ID outside callbacks |
| 2026-07-11 | Final post-review automated and deploy gate | PASS | `make deploy`: 155 suites / 2877 tests, TypeScript, lint, production build, and repo-local deployment pass; deployed `main.js` SHA-256 `ce61fa86...` and `styles.css` SHA-256 `363f48d8...` match `dist` |
| 2026-07-11 | Final runtime and validation Agent Team re-review | PASS | Independent lanes confirmed atomic local Forget redaction, pre-upgrade phase repair, reversed-order safety, settings-tail recovery, exact Chat routes, and no remaining P0-P2; no repeat destructive/iOS smoke is required for this persistence-only fix |
| 2026-07-11 | Final product/docs Agent Team re-review | PASS | Canonical North Star, exact iOS evidence, review failure history, current 2877-test gate, TODO, roadmap, index, plan, SDD, optimization plan, and tracker closure are consistent; no remaining P0-P2 |
| 2026-07-11 | Final docs, diff, and community checks | PASS | Nine active-doc link sets resolve, `git diff --check` is clean, and the runtime style/`innerHTML`/`outerHTML` community scan has no matches |

## Risk Table

| ID | Risk | Severity | Status | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Forget could leave linked private content or allow unchanged relearning | P0 product/privacy contract | Closed | Exact linked cleanup, suppression consumers, content-redacted recovery, resumable retry, and failure/restart tests |
| R2 | Device-local state could be confused with synchronized vault state | P1 boundary | Closed | Same-device vault probes plus isolated Device A/B profiles proved local correction state and deltas do not inherit through the synchronized legacy payload |
| R3 | Profile and durable governance could disagree | P1 correctness/trust | Closed | Governed source, immutable links, serialized Profile port, projection outbox, and restart recovery |
| R4 | Read-only Overview accidentally triggers preparation/provider cost | P1 privacy/cost | Closed | Side-effect-free adapters, negative tests, and unchanged smoke hash |
| R5 | Migration interruption loses or duplicates claims | P1 data integrity | Closed | Deterministic migration, readback, phase recovery, failure matrix, and replay-safe rollback |
| R6 | Recent changes becomes a review queue | P2 product burden | Closed | Event-only UI, no badge/completion state, redacted Forget row, and desktop review |
| R7 | Internal taxonomy leaks into ordinary UI | P2 UX | Closed | Projection, DOM assertions, and real-window review |
| R8 | Existing uncommitted work loses ownership clarity | P1 workflow | Active boundary | No staging, stash, reset, commit, push, or release in this closeout task |
| R9 | One-device finalization could precede another device's legacy import | P1 data integrity | Closed | Device A cutover left the exact legacy payload intact for Device B first start; only the separately confirmed explicit finalization path removed compatibility state |
| R10 | Forget remains recoverable from undo/migration snapshots or a pre-upgrade pending phase | P1 privacy | Closed | Forget start and every persisted resume phase atomically clear applicability, revisions, undo/delta/payload content before external I/O; rollback applies only text-free overlays |
| R11 | Type-C note understanding is absent from the read model | P1 product contract | Closed | Typed loaded snapshot, boundary race protection, coverage UI |
| R12 | Governed claims have no production use consumer | P1 correctness | Closed | Governed-use projection is integrated with positive and fail-closed prompt tests |
| R13 | Type-A extraction races lifecycle cleanup | P1 privacy/correctness | Closed | Serialized Profile governance, outbox, concurrent extraction/action, retry, and restart tests |
| R14 | Raw normalization discards migration evidence | P1 data integrity | Closed | Raw slices are captured before normalization with rejected diagnostics and passthrough coverage |
| R15 | Review Queue Memory content remains in syncable settings state | P1 device boundary | Closed | Composite repository keeps Memory Candidate/conflict local and preserves non-Memory Queue compatibility |
| R16 | Forget lacks durable operation state and exact links | P1 privacy | Closed | Text-free resumable operation, immutable links, bootstrap/background retry, and exact cleanup |
| R17 | Rollback loses post-cutover writes | P1 data integrity | Closed | Per-run delta/payload journal, checksum, replay, readback, lifecycle round-trip, and concurrent-vault tests |
| R18 | Two Vault instances lose or miss collaboration updates | P1 correctness | Closed | Cross-connection CAS/revision/subscription tests plus desktop sequence 24 -> 27 probe |
| R19 | Read-only Overview creates local state or lies about hydration | P1 contract | Closed | Non-creating Profile reader, VSS `unknown`, mutation spies and smoke hash |
| R20 | Canonical Settings becomes user management work | P2 product burden | Closed | Progressive disclosure, no inbox semantics, contextual handoff, and desktop lifecycle smoke |
| R21 | Shared repository mixes per-vault policy or migration cursors | P1 data integrity | Closed | Opaque-keyed policy/migration state, run/partition-bound journal, two-vault migration/rollback, and desktop claim isolation |
| R22 | Delta metadata commits without its rollback payload | P1 data integrity | Closed | Typed payload/checksum writes are atomic and replay fails closed on mismatch |
| R23 | ProfileStore and governance links diverge across a crash | P1 correctness/privacy | Closed | Governed Type-A authority plus durable projection operation/outbox and recovery tests |
| R24 | Queue passthrough overwrites live non-Memory work | P1 data integrity | Closed | Item-partitioned merge, conflict/collision handling, concurrent saves, and restart tests |
| R25 | Migration drops type/sensitivity/applicability | P1 safety/scope | Closed | Schema validation, fidelity assertions, and negative governed-use tests |
| R26 | Type-C survives a changed Data Boundary | P1 privacy | Closed | Boundary fingerprint and aggregate provenance hide stale UI and prompt context |
| R27 | Legacy Type-A adoption guesses sensitivity or loses conversation evidence | P1 privacy/trust | Closed | Persisted provenance, deterministic low-risk allowlist, blocked classifications, and restart tests |
| R28 | Contextual workspace state leaks note provenance or widens actions before/after reload | P1 privacy/authority | Closed | Exact-ID-only state, tri-state cache validation, input normalization, fail-closed recovery, dynamic mode routing, automated regressions, and real reload smoke |
| R29 | A non-settling external cleanup blocks Forget/finalization, plugin bootstrap, or later settings writes | P1 reliability/trust | Closed | Ten-second bounded file transactions release the settings-write tail while retaining fail-closed retry; automated save/retry plus repeated real Forget/finalization and restart/bootstrap paths pass |
| R30 | Reopened Chat collapses multiple same-label governed Memory routes | P2 correctness/control | Closed | Canonical history deduplicates governed Context Used by exact claim ID and preserves both Settings routes in regression coverage |

## Open Decisions

No product decision is open. On 2026-07-11 the user confirmed that Forget
removes PA's saved understanding and future governed use without silently
rewriting existing visible conversations. Message/conversation deletion remains
the explicit way to remove visible chat text from later chat context.

No validation gate or product decision remains open. Future work still requires
new approval if it expands into cross-vault understanding, automatic sync,
standalone Memory UI, first-version import/export, or new action authority.

## External-State Notes

- Linear issue creation was attempted through the connected Linear tool but
  rejected because it would disclose private repository planning details to an
  external destination without explicit authorization.
- Do not retry or use an indirect workaround. Repo docs remain the iteration
  source of truth until the user explicitly authorizes that disclosure.
- The original iteration start was docs-only. That historical statement is now
  superseded by the implementation, full-gate, deploy, and desktop evidence in
  the Verification Log. This closeout task still performs no commit, push,
  release, provider call, or note mutation.
