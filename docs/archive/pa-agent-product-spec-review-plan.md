# PA Agent Product Spec Review Plan

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-06-29

## Status

| Field | Value |
| --- | --- |
| Document type | Review strategy / execution plan |
| Scope | Large PA Agent product-spec implementation diffs based on `pa-agent-product-spec-development-plan.md` |
| Primary inputs | `docs/product/pa-product-north-star.md`, `docs/archive/pa-agent-product-spec-development-plan.md`, `docs/archive/pa-agent-product-spec-development-tracker.md`, current git diff |
| Audience | Codex / implementation agents / review agents |

This plan exists because the PA Agent product-spec implementation can easily
become too large for one useful line-by-line review. The goal is to turn a
large diff into bounded review gates with clear ownership, evidence, severity,
and validation. Do not use this as permission to implement unapproved gates.

## 1. Review Principles

Use the PA Product North Star as the top-level product standard:

> Capture should be light. Review should be natural. Connections should have
> evidence. Maintenance should be reversible. Action should be earned.

The review should optimize for release-blocking correctness and product-contract
risks before polish:

- source notes are protected
- provider calls are disclosed and bounded
- persisted state does not hide raw note text, full provider output, prompt
  chunks, skipped private titles, or memory text
- Pagelet remains the review/decision surface; Bubble remains route-only for
  generated suggestions and only gives soft reminders for user-kept/later items
- Maintenance writes stay previewed, allowlisted, confirmed, confined, audited,
  and undoable
- tests prove failure, stale-state, privacy, and lifecycle edges, not only happy
  paths
- tracker status, review logs, verification logs, and actual code behavior agree

Green tests are supporting evidence, not review closure.

## 2. Snapshot And Re-scope

Before each review pass, refresh the actual surface. Do not rely on this
document's stale file list.

```bash
git status --short --branch
git diff --stat
git diff --name-status
git ls-files --others --exclude-standard
```

At the time this plan was written, the tracked diff was roughly:

- 43 tracked files changed
- about 5524 insertions and 79 deletions
- major touched areas: `src/pa/*`, `src/pagelet/*`, `src/settings.ts`,
  `src/custom.pcss`, locales, Quick Capture, AI-service adapters, docs, and
  many tests
- untracked areas: PA eval fixtures, new PA-focused tests,
  `docs/archive/pa-agent-product-spec-development-tracker.md`, `src/pa/*`,
  `src/quick-capture.ts`, and `src/quick-capture-enrichment.ts`

The first review task is not deep reading. It is creating a review manifest.
The manifest must include one primary slice and all applicable risk tags for
each changed path. Risk tags are many-to-many; a file with `storage`, `provider`,
`write`, `lifecycle`, `generated-asset`, or `user-copy` risk needs signoff from
the matching secondary reviewer even if its primary lane is different.

| Slice / lane | Files | Plan task IDs | Tracker status | Risk tags | Required validation | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| Contracts / eval | `src/pa/contracts/*`, `src/pa/eval/*`, fixtures | M1, M2 | from tracker | storage, privacy, tests | contract/eval tests | TBD |
| Data Boundary / AVI | `src/pa/active-vault-indexer.ts`, adapters/tests | M3, M4 | from tracker | retrieval, provider, privacy | boundary/AVI tests | TBD |
| Quick Capture | `src/quick-capture*`, settings/locales/tests | M7 | from tracker | write, provider, user-copy | capture tests + smoke | TBD |
| Review Queue / Source Cards | stores, Pagelet Panel/Tab/Bubble | M5, M6 | from tracker | storage, lifecycle, UI | queue/Pagelet tests | TBD |
| Insight / Memory governance | saved insight, memory governance, firewall | M8 | from tracker | storage, privacy, Memory | governance/eval tests | TBD |
| Maintenance write boundary | maintenance review/apply, write flow, Pagelet actions | M9 | from tracker | write, storage, lifecycle | write tests + apply/undo smoke | TBD |
| Weekly / Quiet Recall | weekly review, quiet recall, Bubble/Panel/Tab | M10, M11 | from tracker | write, lifecycle, UI | weekly/recall tests + smoke | TBD |
| M12 Retrieval Habit Profile | habit profile code/tests/settings/docs | M12.1 | from tracker | storage, privacy, ranking | habit/profile tests | TBD |
| M12 Graph Discovery | graph discovery code/tests/Pagelet/docs | M12.2 | from tracker | retrieval, UI, privacy | graph/review-queue tests + smoke if visible | TBD |
| M12 Scope Recap | recap/export code/tests/Pagelet/docs | M12.3 | from tracker | provider, write, generated-note | recap/write/Data Boundary tests + smoke if visible | TBD |
| Docs / release / tracker | `docs/*`, `package.json`, generated CSS | M0, release | from tracker | docs, generated-asset, release | link/diff/source checks | TBD |

No reviewer should approve a slice until every changed or untracked file is
assigned to exactly one primary lane and zero or more secondary lanes.

## 2.1 Granularity Finding

The gates and lanes below are necessary but not sufficient for a maximum-depth
review. A lane such as "privacy/data boundary" is still too broad for a large
PA Agent diff because it can hide several independent failure modes:

- schema shape is safe, but one adapter bypasses the Data Boundary
- tests pass, but the real persistence layer stores raw provider output
- Bubble copy looks small, but one action starts provider work before disclosure
- Maintenance preview is safe, but apply/undo misses stale reread or cleanup
- tracker status says done, but smoke evidence does not prove the changed path

Therefore reviewers must execute the task IDs in the next section. The tasks are
small enough to assign independently and concrete enough to mark pass, fail,
deferred, or not applicable.

## 2.2 Required Review Task Breakdown

Use this breakdown after the initial file manifest is built. Each applicable
task needs an explicit result in the final report or tracker review log.

### R0 Intake, Scope, And Authorization

- R0.1 Diff inventory: map every tracked and untracked file to one primary
  slice, one owning plan task, all applicable risk tags, and required secondary
  signoffs.
- R0.2 Approval boundary: verify that runtime code exists only for slices/tasks
  approved in the tracker; `[R]` and future gates must not have hidden runtime
  implementation. If the plan, tracker slice table, phase ledger, review log,
  open decisions, and deferred items disagree about approval state, R0.2 fails.
- R0.3 Risk heatmap: mark each file as contract, storage, provider, UI, write,
  smoke-only, test-only, docs-only, or generated asset.
- R0.4 Reviewability: decide whether the diff must be split before review.
  Approval is blocked, not discretionary, when write/provider/UI/runtime slices
  are mixed without named reviewers, file ownership is unclear, approved and
  unapproved gates are mixed, required secondary signoffs are missing, or the
  review capacity exceeds the named reviewer set.
- R0.5 Generated output check: identify generated CSS, build artifacts, fixture
  data, eval fixtures, and release metadata; confirm whether each is expected.

### R1 Product, SDD, And Design Completeness

- R1.1 North Star journey: walk the user journeys capture -> review -> memory
  candidate -> maintenance -> weekly review -> quiet recall and verify each
  still feels light, source-backed, reversible, and earned.
- R1.2 Spec traceability: every runtime capability maps to plan task IDs,
  product spec decisions, acceptance criteria, validation, and tracker evidence.
- R1.3 Non-goal enforcement: check for accidental `Project` requirements,
  ChatGPT-clone surfaces, broad automation, external actions, telemetry, or
  direct Memory confirmation outside a review path.
- R1.4 Defaults and feature flags: verify disabled defaults for future/proactive
  features, explicit opt-in paths, old setting migration, and no surprise
  behavior after plugin update.
- R1.5 User decision ledger: ensure product semantics, privacy, provider cost,
  source-note mutation, and autonomy changes have recorded approval.
- R1.6 Copy and i18n: compare English and Chinese copy for meaning parity,
  product language, no internal jargon, and no misleading promise of background
  work when the runtime cannot do it.

### R2 Contracts, Persistence, Privacy, And Provider Boundary

- R2.1 Contract shape: review SourceRef, ReplayRef, RetrievalOutcome,
  ReviewQueueItem, Context Trace, Memory lifecycle, and Data Boundary types for
  stable names, narrow unions, and future-safe invalid-state rejection.
- R2.2 Store persistence: inspect local stores, settings, workspace/view state,
  chat history, action logs, and queue records for raw note text, raw memory
  text, full provider output, prompt chunks, private skipped titles, or
  provider dumps.
- R2.3 Data Boundary adapters: verify every real source enumeration,
  retrieval, memory extraction, Pagelet scope, related-note, replay
  re-resolution, and provider-preparation path enforces the boundary. Generate
  per-flow subtasks from the manifest; a single "R2.3 passed" is not acceptable
  without path-level evidence.
- R2.4 Provider disclosure: prove first-use, broad, sensitive, costly, Memory,
  Pagelet, Weekly, Maintenance, and excluded-override flows cannot call the
  provider after cancel or before disclosure. This requires a provider-callsite
  inventory, model-factory grep, cancel-before-model tests, cancel-after-modal
  tests, and visual or DOM smoke for newly visible disclosure flows.
- R2.5 Current-source rehydrate: confirm cards/traces/replay records rehydrate
  visible details from current vault state only when allowed, not from stale
  persisted private text.
- R2.6 Eval negative cases: verify fixtures fail for excerpt leakage, private
  source leakage, tombstone text leakage, unsafe maintenance, wrong context
  count, and missing capture provenance.
- R2.7 Privacy red team: test malicious note text, private folder names, long
  titles, generated Pagelet notes, and denied sources against queue, replay,
  context, Memory, and provider paths.

### R3 Feature Slice Behavior

- R3.1 Quick Capture raw path: exact original text is saved first, empty input
  writes nothing, destination rules are explicit, current-file destination is
  opt-in, and enrichment failure cannot block raw capture.
- R3.2 Quick Capture enrichment: disclosure/cancel paths create no model and no
  queue item; allowed suggestions route only to Review Queue and remain visibly
  AI-generated.
- R3.3 Review Queue lifecycle: validate producer API, allowed item types,
  status transitions, snooze/dismiss/accept semantics, ordering, cleanup, and
  disabled producer behavior.
- R3.4 Source Card family: cards show claim/source/why/action without storing
  hidden raw text; current-scope and global views filter consistently.
- R3.5 Context Pager: compact and expanded states show used/skipped counts,
  blocked/conflict states, no private text, and product language in both Pagelet
  and any Chat metadata hook.
- R3.6 Saved Insight and Memory governance: source-backed insights, user-authored
  unsourced exceptions, memory candidates, tombstones, and Context Firewall
  decisions stay distinct and reviewable.
- R3.7 Weekly Review: sections are source-backed, manual-first, selected-only on
  write, and generated notes use generated-note policy.
- R3.8 Quiet Recall: candidates are evidence-backed, far-association weight is
  bounded, evidence/actions stay in Panel/Tab, and save-as-insight preserves
  provenance.
- R3.9 M12 boundary: if M12 is not approved, Retrieval Habit Profile, graph
  discovery, and scope recap must remain unimplemented. If approved, review
  M12.1, M12.2, and M12.3 as first-class runtime lanes and verify they do not
  introduce graph visualization, provider telemetry, background broad scans, or
  unconfirmed writes.

### R4 Pagelet Runtime, State, And Lifecycle

- R4.1 Foreground run guard: all provider-backed foreground work, including
  review, discovery, summary, capture enrichment handoff, weekly preparation,
  and recall if applicable, uses consistent stale-result protection. Fill the
  foreground work matrix before approval.
- R4.2 Session identity: inspect `sourcePath`, `primarySourcePath`, pending save
  target, active leaf, current panel layout, and tab session id across open,
  close, expand, save, rerun, and error paths.
- R4.3 Close/unmount behavior: real `PanelView.close()`, `onClose`, React
  `root.unmount()`, timers, observers, debouncers, and event listeners clean up
  without destroying needed state.
- R4.4 Bubble arbitration: at most one nudge wins; Bubble content is route-only;
  Dismiss/Later/View do not start writes or provider calls outside the intended
  route.
- R4.5 Commands and aliases: command ids, labels, legacy aliases, command
  registration, and Pagelet route targets remain compatible.
- R4.6 Obsidian view state: workspace/view state stores only lightweight
  metadata, not full provider output, generated markdown, private text, or
  pending write payloads. The state persistence inventory must also classify
  module caches, local stores, settings, transient Tab action state, and vault
  writes.
- R4.7 Error and retry states: degraded providers, missing files, denied
  sources, empty vaults, stale sessions, and cancelled modals show recoverable
  states and do not leave dirty hidden state.

### R5 Retrieval, Memory, VSS, And Performance

- R5.1 AVI/VSS boundary: new AVI behavior wraps existing VSS without changing
  storage semantics, operation queue guarantees, fallback read-only behavior, or
  Chat main retrieval unless explicitly approved.
- R5.2 Retrieval statuses: evidence_found, partial_evidence, conflict,
  no_evidence, and blocked_by_privacy map to user-facing states without
  implying action-ready certainty.
- R5.3 Ranking and signals: activity, structure, habit, and far-association
  signals are weak where required and cannot outrank strong source evidence or
  cross the Data Boundary.
- R5.4 Snapshot race review: changed-note refresh, snapshot delete/upsert,
  reconcile, flush, rename, reset, and rebuild paths must not overwrite newer
  vault state.
- R5.5 Large-vault performance: scan frequency, batching, memoization, render
  loops, memory growth, provider calls, and startup/resume work stay bounded.
- R5.6 Fallback/degraded mode: non-durable or fallback states do not claim
  background maintenance, auto-refresh, or ready Memory behavior that cannot run.

### R6 Maintenance And Write Action Safety

- R6.1 Proposal quality: inbox, weak-title, orphan/weak-link, and future
  scanners produce source-backed proposals with affected paths and no source
  mutation.
- R6.2 Apply allowlist: only the approved action family is executable; merge,
  patch, link changes, archive, delete, index-note, multi-file actions, and
  external actions remain blocked until separately approved.
- R6.3 Target confinement: reject absolute paths, parent traversal, `.obsidian`,
  plugin folders, generated folders, excluded folders, non-Markdown targets,
  collisions, and prompt-injected target changes.
- R6.4 Stale reread and atomicity: reread source/target state immediately before
  mutation; cancel/close/error applies nothing; partial failures leave a clear
  recovery path.
- R6.5 Audit and undo: action log has action id, old/new path, timestamp,
  sourceRefs, status, and enough recovery metadata for undo; cleanup can remove
  smoke residue.
- R6.6 UI confirmation: confirmation copy names old/new paths and action scope
  using current vault state, not note-provided instructions.

### R7 UI, Accessibility, Mobile, And Visual Quality

- R7.1 Surface ownership: Bubble, Panel, Detail Tab, Settings, modals, and Chat
  hooks each show only the level of detail they own. Fill the route/action
  matrix for every changed item type before approving Pagelet UI changes.
- R7.2 Accessibility: keyboard path, focus restoration, ARIA labels, button
  names, disabled states, and screen-reader text are meaningful.
- R7.3 Mobile: touch targets, viewport height, safe areas, scroll containers,
  long paths, multiline captures, and cramped settings panes do not overflow or
  clip key actions.
- R7.4 Visual state coverage: loading, empty, blocked, partial, conflict,
  denied, success, error, snoozed, dismissed, applied, undone, and stale states
  all render intentionally for every changed surface; generate per-surface
  subtasks from the review manifest.
- R7.5 CSS scope: styles are scoped with `pa-` conventions, generated from
  `src/custom.pcss`, and do not leak into Obsidian core UI.

### R8 Obsidian, Release, Docs, And Compatibility

- R8.1 Community blockers: no runtime `<style>` creation, `innerHTML` assignment,
  or `outerHTML` assignment in plugin DOM code.
- R8.2 Obsidian API compatibility: verify compatibility-sensitive claims
  against installed `obsidian@1.12.3` typings/runtime before accepting broad
  refactors.
- R8.3 Settings and storage migration: old settings, storage keys, command ids,
  DB/storage scopes, and persisted queue/action states remain readable or have a
  deliberate migration/default path. Split this into explicit checks for legacy
  `data.json`, workspace/view state, queue/action-log serialization, command
  aliases, cleanup groups, and stale raw-provider-output scrubbing. Add
  fixture-based deserialization tests or manual readback evidence; absence of
  such evidence blocks approval when storage changed.
- R8.4 Package/deploy assets: any new worker, WASM, generated CSS, eval fixture,
  or release asset has build, deploy, release, install, and docs coverage.
- R8.5 Docs links and tracker drift: all new docs links exist; tracker logs,
  verification logs, risk table, roadmap, TODO, and docs index agree with real
  code and actual validation.

### R9 Validation, Smoke, And Evidence Quality

- R9.1 Test adequacy: focused tests cover happy path, cancel, failure, disabled,
  stale, denied, collision, cleanup, reload, and undo paths where applicable.
  Generate a path-level test matrix from the manifest rather than marking the
  whole R9.1 task passed.
- R9.2 Broad automated gate: run broad validation only after focused blockers
  are fixed, then record exact commands and results.
- R9.3 Obsidian smoke design: smoke must exercise the changed real surface, not
  merely mount the plugin. `make deploy` is not enough: reload the plugin in the
  test vault, read back the loaded plugin/version/state, then record exact
  commands, DOM/readback/screenshot evidence, `dev:errors`, and cleanup.
- R9.4 Cleanup verification: any test-vault file, queue item, action log,
  settings change, generated note, or fixture residue created by smoke is
  removed or explicitly documented.
- R9.5 Review reproducibility: final report lists covered review task IDs,
  uncovered task IDs, skipped validations, residual risks, and exact follow-up
  owners.

## 2.3 Maximum-depth Assignment Rule

For ordinary review, each applicable R task needs one accountable reviewer. For
maximum-depth review, add an independent second pass for these high-risk tasks:

- R0.2 approval boundary and R0.4 reviewability
- all R1 product/SDD tasks when user-facing behavior or defaults changed
- all R2 persistence, Data Boundary, privacy, and provider-boundary tasks
- R4.1-R4.7 Pagelet state, lifecycle, view-state, and error tasks
- all R6 write-action and Maintenance safety tasks
- R8.1-R8.4 community, API compatibility, settings migration, and package tasks
- R9.1-R9.4 validation, smoke, and cleanup evidence tasks

The second pass should assume the code compiles and the happy path works. Its
job is to find hidden side effects, stale-state paths, old-setting upgrades,
provider/cancel leaks, persistence mistakes, cleanup residue, and docs/runtime
contradictions. If reviewers disagree on severity, keep the higher severity
until the trigger path is disproven with local evidence.

## 2.4 Required Coverage Matrices

For maximum-depth review, do not rely on prose that says a broad R task passed.
Create or update these matrices in the tracker, a review report appendix, or a
temporary review artifact linked from the final report:

| Matrix | Required columns | Required when |
| --- | --- | --- |
| Review coverage matrix | R task ID, path/flow, files, risk tags, primary reviewer, secondary signoffs, evidence link, commands/smoke, issue IDs, disposition | Always for broad PA Agent diffs |
| Provider-callsite inventory | callsite, feature, disclosure gate, cancel-before-model evidence, cancel-after-modal evidence, provider/model path, smoke evidence | Any provider-backed or provider-prep change |
| Foreground work matrix | entrypoint, async owner, run token/guard, source identity, destination surface, duplicate-trigger policy, close/unload behavior, stale completion behavior, tests | Any Pagelet/runtime async change |
| State persistence inventory | state owner, serialized location, allowed fields, prohibited fields, lifecycle, reload behavior, cleanup path, tests | Any store, view state, settings, cache, history, or vault-write change |
| Route/action matrix | item type, Bubble display/actions, Panel display/actions, Tab display/actions, command route, provider allowed, write allowed, tests/smoke | Any Pagelet UI, Bubble, queue, weekly, recall, or maintenance change |
| Command compatibility matrix | canonical id, legacy id, EN/ZH label, callback target, default hotkey, smoke-runner reference, deprecation policy | Any command or route change |
| Legacy state matrix | legacy settings key/data shape, old workspace/view state, old queue/action-log shape, migration/default behavior, fixture/manual readback | Any settings/storage/schema change |
| Smoke evidence matrix | surface, status, exact commands, reload/readback evidence, Obsidian/plugin version, provider/model state, DOM/screenshot artifacts, `dev:errors`, cleanup readback | Any Obsidian smoke claim |

## 3. Review Order

Review in this order, even if the diff was implemented in a different order.

### 3.1 Gate 0: Plan, Tracker, And Approval Boundary

Purpose: catch unauthorized scope before code detail consumes attention.

Check:

- `docs/archive/pa-agent-product-spec-development-plan.md` and tracker agree on what is
  planned, done, ready for review, and still unapproved.
- Any slice marked `[x]` has corresponding code, tests, validation evidence,
  and smoke evidence where required.
- Any slice marked `[R]` or not approved has no runtime implementation hidden in
  the diff.
- Stop points from the development plan are not bypassed.
- User-facing wording follows product language, not internal terms like VSS,
  RAG, embeddings, OPFS, vector, backend, or chunks.

Blockers:

- runtime code exists for a gate that remains only `[R]` or unapproved
- tracker says done but code/tests/smoke evidence are missing
- product semantics, privacy, provider cost, source-note mutation, or autonomy
  changed without an explicit recorded decision

### 3.2 Gate 1: Contracts, Persistence, And Privacy

Purpose: make the data model safe before trusting UI or orchestration.

Review:

- `SourceRef`, `ReplayRef`, `RetrievalOutcome`, `ReviewQueueItem`, Memory
  lifecycle, Context Trace, Data Boundary, and eval schemas.
- Stores and adapters persist ids, hashes, counts, reasons, statuses, source
  refs, and timestamps, not raw excerpts or full model output.
- Negative eval fixtures fail when private text, raw excerpts, memory text, or
  unsafe actions leak.
- Generated Pagelet notes, excluded folders, private sources, and tombstones are
  handled as denied or text-free where required.

Typical P1 findings:

- raw source note text or full provider output stored in queue/replay/context
  state
- provider-backed scan can run before disclosure or after cancel
- Data Boundary is enforced in tests but bypassed by a real adapter

### 3.3 Gate 2: Pagelet State, Routing, And Concurrency

Purpose: catch bugs that happy-path UI tests usually miss.

Review:

- `src/pagelet/orchestrator.ts`, `PanelView`, `TabView`, `PageletDetailView`,
  `BubbleCoordinator`, command registration, and save flow.
- Foreground provider work uses a consistent run guard.
- Stale results cannot mutate a newer Panel/Tab session.
- `sourcePath`, `primarySourcePath`, and pending save target are not confused.
- Closing Panel/Tab, expanding to Detail Tab, or dismissing Bubble does not
  drop user-visible draft state or source context.
- Bubble content remains count/nudge/route only; evidence, source lists,
  accept/save/apply actions, and generated sections stay in Panel/Tab.

Typical P2 findings:

- concurrent runs can overlap and overwrite current session state
- Panel close clears context needed by Tab save or relative-link resolution
- Bubble exposes heavy review cards or action controls

### 3.4 Gate 3: Write Actions And Maintenance Safety

Purpose: protect source notes and preserve trust.

Review:

- Maintenance apply is limited to the approved action family.
- Preview shows old path, new path, affected path, source reason, and undo
  metadata before apply.
- Target confinement rejects absolute paths, parent traversal, `.obsidian`,
  plugin folders, generated Pagelet folders, Data Boundary excluded folders,
  non-Markdown targets, and collisions unless a safe non-colliding target is
  explicitly chosen.
- Stale reread checks current file state immediately before mutation.
- Cancel/close applies nothing.
- Action log and recovery metadata are enough to undo.
- Prompt-injection text inside source notes cannot alter action family, target,
  scope, or confirmation copy.

P0/P1 findings include data loss, hard delete, source-note mutation without
approval, broad action families sneaking in, or non-undoable writes.

### 3.5 Gate 4: Product UX, Mobile, Accessibility, And Copy

Purpose: make sure the implementation feels like PA, not a busy AI control
panel.

Review:

- Quick Capture saves original thought first and never blocks on enrichment.
- Review Queue cards explain claim/source/why/action without jargon.
- Context Pager explains used/skipped context without exposing internals.
- Weekly Review writes only accepted source-backed items.
- Quiet Recall is low-frequency and evidence-backed.
- Settings copy describes Memory, capture, review, data boundaries, and actions
  in ordinary user language.
- Focus restoration, keyboard navigation, ARIA labels, touch targets, overflow,
  text wrapping, and mobile layout hold up.
- CSS stays scoped under `pa-` conventions and comes from `src/custom.pcss`,
  not runtime style injection.

### 3.6 Gate 5: Tests, Eval, And Fixtures

Purpose: decide whether tests prove the product contract rather than only the
implementation's easiest path.

Review:

- deterministic fixtures use synthetic vault data and no provider credentials
- negative fixtures cover privacy leaks, wrong counts, hard delete, unsafe
  maintenance, missing capture provenance, and memory tombstone leakage
- focused Jest tests cover empty state, disabled settings, cancel, failure,
  stale state, collisions, denied sources, cleanup, and undo
- tests do not assert implementation details so tightly that safe refactors
  become expensive
- tests include at least one integration path per visible Pagelet surface

## 4. Parallel Review Lanes

Use parallel reviewers when available. Each reviewer should return findings
with file/line references, severity, trigger path, and suggested fix.

The lanes below are coordination lanes, not a substitute for the R0-R9 task
breakdown. A lane is complete only after its applicable task IDs are reported.

Recommended lanes:

| Lane | Primary question | Primary files |
| --- | --- | --- |
| Product/SDD contract | Does behavior match North Star, plan, tracker, stop points, and approval boundaries? | docs, settings/locales, Pagelet UI |
| Privacy/data boundary | Can private note text, provider output, prompt chunks, or denied sources leak or persist? | `src/pa/contracts`, stores, eval, adapters |
| Runtime state/concurrency | Can stale async work, close/unmount, or route switching corrupt visible state? | Pagelet orchestrator, Panel, Tab, Bubble, history |
| Write/action safety | Can PA mutate source notes outside preview, confirmation, confinement, allowlist, audit, or undo? | maintenance apply, write flow, queue status |
| UI/accessibility/mobile | Does the visible experience stay quiet, source-backed, navigable, and responsive? | Pagelet UI, Bubble, settings, CSS |
| Test/eval quality | Do tests protect the actual contract, including failures and negative cases? | `__tests__`, `__fixtures__`, eval runner |
| Obsidian/release compatibility | Are lifecycle, DOM rules, generated CSS, commands, packaging, and docs links safe? | plugin wiring, CSS, docs, package/release |

When merging reviewer output, prioritize the highest-severity verified issue,
not the largest number of comments.

## 5. Validation Matrix

Run focused checks per lane first, then the broad gate after fixes.

### 5.1 Focused Checks

Contracts, eval, Data Boundary, AVI:

```bash
npm test -- --runTestsByPath __tests__/pa-contracts.test.ts __tests__/pa-eval.test.ts __tests__/data-boundary.test.ts __tests__/active-vault-indexer.test.ts __tests__/get-vss-files.test.ts __tests__/memory-extraction.test.ts __tests__/pa-agent-runtime-search-vss.test.ts
npm run eval:pa:fast
```

Quick Capture and enrichment:

```bash
npm test -- --runTestsByPath __tests__/quick-capture.test.ts __tests__/quick-capture-enrichment.test.ts __tests__/review-queue-store.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts
```

Review Queue, Context Pager, Saved Insight, Memory governance:

```bash
npm test -- --runTestsByPath __tests__/review-queue-store.test.ts __tests__/context-pager.test.ts __tests__/saved-insight-store.test.ts __tests__/memory-governance-store.test.ts __tests__/pa-agent-history.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pa-eval.test.ts
```

Copy and i18n:

```bash
npm test -- --runTestsByPath __tests__/settings.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-bubble-content.test.ts
```

Also manually review changed English/Chinese locale keys and the settings-copy
inventory when no dedicated locale parity test exists.

Provider disclosure inventory:

```bash
rg -n "createChatModel|create.*Model|AIProvider|provider|stream|complete" src
```

Map each real provider-preparation or model-creation path to disclosure and
cancel evidence before approval.

Maintenance and write action:

```bash
npm test -- --runInBand __tests__/maintenance-review-apply.test.ts __tests__/maintenance-review.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/pagelet-commands.test.ts __tests__/settings.test.ts __tests__/pa-eval.test.ts
```

Weekly Review, Quiet Recall, Bubble:

```bash
npm test -- --runInBand __tests__/weekly-review.test.ts __tests__/quiet-recall.test.ts __tests__/pagelet-bubble-content.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-panel-tab-view.test.ts __tests__/settings.test.ts
```

### 5.2 Broad Gate

Use after P0/P1/P2 fixes and before final approval.

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck --pretty false
npm run eval:pa:fast
npm run lint
npm run build
rg -n "createElement\\([\"']style[\"']\\)|\\.innerHTML\\s*=|\\.outerHTML\\s*=" src
git diff --check
make deploy
git status --short
```

For the source scan, exit code 1 with no output is a pass.

### 5.3 Release-facing Gate

Run this gate when the diff changes dependencies, package scripts, release
automation, generated runtime assets, bundled assets, manifest behavior, worker
or WASM packaging, or other release-facing surfaces:

```bash
npm run check:third-party-notices
npm run audit:bundle
make release-dry-run VERSION=<next>
git status --short
```

Also verify the expected release asset set and note any generated artifacts that
were changed by build or deploy.

## 6. Obsidian Smoke Matrix

Do not claim Obsidian behavior was validated unless `make deploy` and real
test-vault observation ran. Smoke must begin by reloading the deployed plugin
and reading back the loaded plugin/version or relevant runtime state; otherwise
the smoke may be observing a stale running bundle.

Minimum smoke precondition:

```bash
make deploy
obsidian plugin:reload id=personal-assistant vault=test
obsidian plugin id=personal-assistant vault=test
```

Minimum smoke coverage for the current broad PA Agent surface:

| Surface | Required smoke evidence |
| --- | --- |
| Settings / Data Boundary | Settings section renders in the real test vault; disabled cleanup controls stay disabled; `dev:errors` clean |
| Quick Capture raw save | Command/modal appears; exact text saves to configured target; empty input writes nothing; no AI call before enrichment/disclosure |
| Review Queue / Context Pager | Pagelet Panel current-scope queue and Detail Tab global queue render; Context Pager uses product language; injected test queue item can be cleaned |
| Capture enrichment | Raw save remains first; cancel/no-disclosure path creates no model and no queue item; only durable or user-kept suggestions can enter Review Queue |
| Saved Insight / Memory governance | Pagelet Detail Tab shows source-backed insights and text-free forgotten state; no raw memory text leaks into UI or persisted state |
| Maintenance preview | Manual command creates preview-only source-backed proposals; no apply controls for unsupported actions; cleanup removes proposals/temp notes |
| Maintenance apply | Approved move-only proposal shows confirmation, moves one note, updates action log/status, undo restores old path, cleanup removes smoke residue |
| Weekly Review | Manual command opens weekly sections; generated note includes accepted source-backed items only |
| Quiet Recall | Manual recall shows why-now/source/next-action in Panel/Tab; save-as-insight creates source-backed Saved Insight |
| Slice G if approved | Bubble recall nudge is disabled by default; when enabled, View routes to Quiet Recall, Dismiss/Later only update local suppression, and no writes occur |

Prefer CLI/DOM readback for precision, and add screenshots when layout or mobile
visual behavior is under review.

## 7. Severity And Disposition

Use these severities:

- P0: data loss, source-note corruption, security/privacy breach, plugin unusable
  on a common path
- P1: release-blocking correctness or product-contract violation, including
  privacy/persistence leaks, unapproved autonomy/write behavior, provider calls
  before disclosure, or Obsidian community review Error findings
- P2: must fix before merge/release for likely user-visible failure, stale state,
  concurrency, wrong file write/open, broken release docs link, serious
  accessibility/focus issue, or missing required smoke
- P3: optional polish, maintainability risk, visual refinement, or performance
  concern without a concrete failure path

Every finding must include:

- severity
- file and line
- trigger path
- user impact
- suggested fix or decision needed
- validation expected after fix

Classify dispositions as:

- `must fix before approval`
- `needs user decision`
- `safe conservative fix`
- `defer with owner and unblock condition`
- `not actionable / false positive with evidence`

## 8. Remediation Loop

After the first review pass:

1. Merge duplicate findings and verify the highest-severity claims locally.
2. Separate `needs user decision` from `safe conservative fix`.
3. Fix P0/P1/P2 issues in module-scoped batches.
4. Re-run only the focused checks for the touched lanes.
5. Re-run the broad gate after all blocking fixes.
6. Re-run Obsidian smoke for any visible UI/runtime/write behavior changed by
   the fix.
7. Update tracker Review Log, Verification Log, Risk Table, Open Decisions, and
   Deferred Items together.

Do not mark a slice done because tests pass. Mark it done only when the review
disposition, validation evidence, and smoke evidence all match the plan.

## 9. Final Review Report Format

Use this shape for the final review report:

```markdown
**Findings**
- P1 [file](/absolute/path:line): concise issue.
  Trigger/impact. Suggested fix.

**Gate Result**
- Approved / Blocked / Approved after listed fixes.
- Slices covered.
- Slices explicitly not covered.

**Review Task Coverage**
- R task IDs passed.
- R task IDs failed or blocked.
- R task IDs skipped as not applicable, with reason.

**Validation**
- Checks run.
- Checks not run and residual risk.

**Smoke Evidence**
- Smoke evidence matrix rows, keyed to every applicable smoke surface.
- Exact commands, reload/readback evidence, DOM/screenshot artifact paths,
  `dev:errors`, and cleanup readbacks.

**Tracker Updates Needed**
- Review log rows.
- Verification log rows.
- Risk/open-decision/deferred-item changes.
```

Findings lead the report. Summaries and praise are secondary.

## 10. Approval Rule

A large PA Agent product-spec diff is not review-approved until all of these are
true:

- every changed and untracked file is mapped to a slice/lane
- every applicable R0-R9 review task has a pass, fail, defer, or not-applicable
  disposition
- no unapproved gate has runtime implementation
- no P0/P1/P2 finding remains unresolved; unresolved P0/P1/P2 findings keep the
  gate `Blocked`. Only P3 or non-release follow-ups may be deferred under an
  approved result, and they still need owner, reason, and unblock condition
- focused lane checks pass
- broad automated gate passes
- `make deploy` passes when runtime/UI behavior changed
- real Obsidian smoke passes for changed visible or write/action surfaces
- tracker evidence is updated and does not contradict code
- required coverage matrices are complete for the touched surfaces
- final report states covered scope, uncovered scope, residual risks, and exact
  validation evidence
