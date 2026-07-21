# Pagelet UI/UX Optimization SDD

Document status: Approved
Updated: 2026-07-21
Work item: B-118
Authority: B-118 的批准设计、接口边界、slice 验证矩阵与回滚约束。
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)
Product spec: [Pagelet UI/UX Hardening Product Spec](../../../product/specs/pagelet-ui-ux-hardening-product-spec.md)
Decision: [DEC-021 — evidence-led Pagelet UI/UX hardening](../../../product/decisions/dec-021-evidence-led-pagelet-ui-ux-hardening.md)
Provider trust amendment: [DEC-023 — shared non-blocking Pagelet provider first-use](../../../product/decisions/dec-023-shared-pagelet-provider-first-use.md)
Quiet Recall retrieval amendment: [DEC-024 — cold semantic retrieval uses the existing actual-call budget](../../../product/decisions/dec-024-quiet-recall-cold-semantic-retrieval.md)
Evidence handoff: [Claude Code Handoff](./handoff-claude-code.md)

## Scope

Fix 6 P1 + 6 P2 + 1 P3 confirmed by real desktop/iPhone evidence and completion
review, including the P2 Quiet Recall semantic/source-freshness drift confirmed
during the 2026-07-21 B-118 runtime completion audit.
Preserve existing positive baselines (mobile safe area, 44×44 targets, short tap,
hold menu appearance). All SG-01~07 product decisions resolved 2026-07-20.
DEC-023 on 2026-07-21 is the current authority for SG-05/SG-06 provider
first-use behavior. DEC-024 Option A on the same date is the current authority
for Quiet Recall pure-semantic candidate generation, total actual-call budget,
metadata fallback and the narrowed zero-call boundary.
The same 2026-07-21 DEC-023 Option A classifies foreground Review by actual
allowed sources and gives generic background preload one exact, silent-fail-
closed standard envelope.

## Traceability Matrix

| Product requirement | Acceptance criterion | SDD slice |
| --- | --- | --- |
| B-118/REQ-01 | B-118/AC-01 | Slice A — Pet touch ownership |
| B-118/REQ-02 | B-118/AC-02 | Slice B — Recap first-screen value |
| B-118/REQ-03 | B-118/AC-03 | Slice B/C — shared provider notice, Review actual-source classification, and old Modal removal |
| B-118/REQ-04 | B-118/AC-04 | Slice D — reduced motion |
| B-118/REQ-05 | B-118/AC-05 | Slice E — Recall actions |
| B-118/REQ-06 | B-118/AC-06 | Slice D — Pet lifecycle convergence |
| B-118/REQ-07 | B-118/AC-07 | Slice E — Quiet Recall settings |
| B-118/REQ-08 | B-118/AC-08 | Slice F — typography floor |
| B-118/REQ-09 | B-118/AC-09 | Slice F — active-leaf placement |
| B-118/REQ-10 | B-118/AC-10 | Slice C — shared Data Boundary/provider trust + Review/preload classification + Quiet Recall semantic retrieval |

## Non-Goals

- No Pagelet IA redesign.
- No new durable writes, queue models, or provider capabilities beyond existing contracts.
- No release actions (commit/push/tag/publish not authorized by SDD).
- No Quiet Bubble empty-state redesign (SG-07c deferred).
- No rename of Quiet Recall in English (SG-07a: keep name, only change Chinese label).

## SG Decisions Applied

| Gate | Decision | Impact on SDD |
|------|----------|---------------|
| SG-01 | Off/On two-tier, no frequency cap | Settings UI: single toggle, quality gates only |
| SG-02 | View + Later + Dismiss | Bubble actions finalized |
| SG-03 | Dismiss = weak signal, specific candidate only | RHP: minimal effect on dismiss |
| SG-04 | Later = enter Review Queue | Change from 24h snooze to queue handoff |
| SG-05 | Shared first-use across all Pagelet provider paths | One shared disclosure state; a complete first high-risk blocking disclosure may satisfy it; no feature authorization |
| SG-06 | Remove Modal; standard bounded path defaults on + first-use notice | Preserve existing opt-out; do not reset shared notice |
| SG-07a | Chinese "相关回顾" | i18n label change only |

## Provider Trust Model

Per North Star and DEC-023, configuring an AI provider is a trust decision.
When Pagelet and the relevant capability are enabled, sources pass Data Boundary,
and the run stays inside that capability's standard bounded envelope, the first
actual provider call shows the shared non-blocking notice and the eligible run
continues. The notice explains note-excerpt transmission, possible API cost, and
the Settings opt-out. It only means “notice shown”: it is not authorization for
Memory admission, persistence, vault writes, Markdown, or external actions.

`pageletProviderFirstUseNotified` is the only shared first-use field. Existing
`true` and capability opt-outs survive reload/upgrade; implementation must not
reset, migrate, or shadow it with feature-specific state. Broad, sensitive,
costly, whole-vault, out-of-envelope, and excluded-scope override runs remain
blocking `run / adjust / cancel` flows before any provider call or cost
reservation. Provider missing, disabled capability, no eligible source, and
Data Boundary deny remain zero-call fail-closed paths.

If the first actual call is high-risk, a blocking disclosure that fully covers
allowed note excerpts/data, provider, possible cost, and the capability opt-out
also satisfies shared first-use; do not add the non-blocking notice. Persist the
flag only after explicit `Run`, all gates pass, and invocation is immediately
next. Cancel/passive close does not persist it. Adjust stays behind the blocking
gate while still high-risk, or uses the ordinary shared notice after becoming
standard bounded. The shared flag never suppresses later per-run high-risk gates.

Foreground Review classification happens only after Data Boundary filtering and
source de-duplication, using the actual source set that would be sent in this
run. `actualAllowedSources.length <= 1` is standard bounded; `>1` is high-risk.
The requested range is not the classifier, so `last7` with only one actual
allowed source stays standard. A high-risk Review reserves no provider-call
slot or cost before affirmative `Run`; `Adjust` rebuilds the eligible source set
and reruns classification.

Generic background preload is standard bounded only when all conditions are
true: explicit opt-in, changed-only, sources from the recent 7 days, actual
provider input `<=4K`, requested output `<=1K`, actual calls within 2 per rolling
hour and 20 per local day, `allowWrite=false`, every actual source passes the user's explicit shared
Data Boundary decisions, and no whole-vault or excluded-scope override. The
runtime derives this from per-source folder/tag/generated-source decisions; it
does not infer content sensitivity or trust a caller-owned `sensitive=false`.
No related-note lookup may expand the prompt beyond the current changed batch;
the current generic path therefore performs only its bounded generation call.
Any failed condition returns a silent skip before shared notice,
provider invocation, quota/cost reservation, or shared-flag mutation. It must
not open the high-risk modal. The generic “broad/weekly scan” label explicitly
excludes this complete narrow envelope.
The background call counter persists content-free timestamps per vault so
reload/toggle cannot reset either hard cap; unavailable or malformed storage is
a fail-closed skip. Hourly is rolling, while daily resets at local midnight.
The changed-only detector separately persists a content-free per-vault map of
source path to last accepted mtime. Reload/toggle preserves it; only source
snapshots from an accepted provider result advance it. A zero-call result does
not mark a source analyzed or overwrite the cache. Missing storage access or a
malformed state fails closed, while a missing key is the valid fresh baseline.

For Quiet Recall, a cold semantic query embedding is itself an actual Pagelet
provider call. It enters the same DEC-023 admission only after capability,
provider, Data Boundary, eligible source/query, Memory index ready, cooldown,
the existing Quiet Recall 10/hour、50/day total-call budget, and source/current-run
revalidation pass. Query embedding、candidate evaluator 与 language retry use
that one budget; no retrieval-specific quota or first-use state exists. An empty
local vector search makes no downstream evaluator/generation call. Metadata-only
matching is allowed only as an index-unavailable, explicit-Discover local clue.

All Pagelet provider paths share one source classifier: shared Data Boundary AND
Pagelet-local exclusions from `ScopeResolver`, followed by a live Markdown-body
check tied to a pre/post-read mtime+size snapshot. This classifier covers Review,
generic preload, Scope Recap, Discover retrieval/generation and Quiet Recall
retrieval/evaluation. Cold retrieval validates the primary latest body before
building or sending the query embedding. Quiet Recall Saved Insight collection
deduplicates source paths, live-reads every `sourceRef`, and accepts the Insight
all-or-nothing; any missing、unreadable、changed or denied ref suppresses its text.
Only captured read-time snapshots may satisfy later evaluator revalidation.

---

## Slice A: Pet Touch Ownership (F-01 / REQ-01 / AC-01)

### Design

**Files**: `src/pagelet/pet/PetView.ts`

**Root cause**: Pet root `touchend` handler (line ~168-179) unconditionally calls
`onToggleBubble()` without checking if the event originated from a hold menu item.
Menu buttons only listen on `click` with `stopPropagation`, but on iOS the
`touchend` fires on the root BEFORE the synthetic `click` reaches the button.

**Fix approach**:

1. In Pet root `_handleTouchend`, check `e.composedPath()` for
   `.pa-pagelet-pet-hold-menu` or descendants. If found, return without toggle.

2. Each menu button in `showHoldMenu()` owns `touchstart`/`touchend`/`click`:
   - `touchstart`: set a `menuItemTouched` flag, `stopPropagation()`
   - `touchend`: `stopPropagation()`, `preventDefault()`, execute callback once
     via a guard flag, then dismiss menu
   - `click`: if already executed via touch, `stopPropagation()` and return
     (synthetic click suppression); otherwise execute callback (keyboard/mouse path)

3. Cancel conditions on menu items:
   - `touchcancel`: clear flag, 0 callbacks, 0 root toggle
   - `touchmove` > 12px from start: clear flag, 0 callbacks
   - Multi-touch (`e.touches.length > 1`): clear flag, 0 callbacks

4. Keyboard (Enter/Space) on focused menu button: execute callback once,
   `stopPropagation()` to prevent root handler, dismiss menu, restore focus.

5. Cleanup: `dismissHoldMenu()` removes all button event listeners, clears
   timer, clears outside-pointer listener (existing), clears any pending flags.

**Preserved behaviors**: 400ms synthetic-click suppression on Pet root, 520ms
hold timing, 3s auto-dismiss, outside pointer dismiss, desktop mouse click path.

### Tests

- Menu-origin `TouchEvent` sequence (touchstart + touchend) on each button:
  target callback = 1, root `onToggleBubble` = 0.
- Synthetic click after touch: target callback still = 1 (not 2).
- Short tap Pet (no hold): `onToggleBubble` = 1, menu callbacks = 0.
- Hold ~520ms: menu appears, Bubble unchanged.
- `touchcancel` on menu item: target = 0, root = 0.
- Movement > 12px on menu item: target = 0, root = 0.
- Multi-touch on menu item: target = 0, root = 0.
- Enter/Space on focused menu button: target = 1, root = 0.
- 3s timeout: menu removed, all callbacks = 0.
- Outside pointer: menu removed, all callbacks = 0.
- `destroy()`: all listeners/timers cleared.

---

## Slice B: Recap First-Screen + Authorization Removal (F-02, F-03 / REQ-02,03 / AC-02,03)

### Design — F-02 Recap Bubble Content

**Files**: `src/pagelet/bubble/BubbleContent.ts`, `src/pagelet/orchestrator.ts`

**Fix**: In `buildPreparedRecapDeliveryContent()`:
- Primary finding text = `candidate.body` (strongest concrete observation)
- `candidate.title` and source count/ref become secondary visible metadata
- `pageletT("pagelet.bubble.recapDelivery")` demoted to status label
- `whyNow[0]` stays as inline hint explaining temporal relevance
- Long content: safe truncation/ellipsis in Bubble; full content in Detail

In orchestrator Recap Detail payload:
- Add explicit `scope` (folder/tag range used)
- Add localized `generatedAt` (user-readable date/time, not ISO string)
- Add coverage/freshness in product language (not `stale/fresh/cache`)
- View action uses current prepared artifact; provider call count = 0

### Design — F-03 Remove Modal, Reuse DEC-023 Shared Notification

**Files**: `src/pagelet/recap/ScopeRecapAuthorizationModal.ts` (delete or gut),
`src/pagelet/orchestrator.ts`, `src/settings/pagelet/index.ts`

Per SG-06: remove the Modal entirely. Replace with:

1. **Settings**: `scopeRecapPreparationEnabled` remains the capability opt-out.
   New defaults may be enabled per SG-06, but an existing persisted `false` must
   remain `false` across reload/upgrade.

2. **First-use notification**: Immediately before the first actual eligible
   Pagelet provider call, use the shared non-blocking notification route. It
   explains note-excerpt transmission, possible provider cost, and the Settings
   opt-out, then the current bounded run continues.

3. **Orchestrator changes**: Remove `showScopeRecapAuthorizationModal()` call.
   Instead, check `scopeRecapPreparationEnabled` directly. If enabled, proceed.
   If disabled, skip (no modal, no prompt).

4. Track only `pageletProviderFirstUseNotified: boolean`. Do not add
   `scopeRecapFirstRunNotified` or any feature-specific authorization field.
   Once any bounded Pagelet surface shows the notice, other surfaces do not
   repeat it; existing `true` is never reset.

5. If a run is broad/sensitive/costly/whole-vault/out-of-envelope or requests
   excluded-scope override, route to blocking `run / adjust / cancel` before
   provider call or cost reservation. If it is also the first actual provider
   call, a complete blocking disclosure may satisfy shared first-use without an
   extra notice; write the flag only after explicit Run, all gates pass, and the
   call is immediately next. Cancel/close/unpassed Adjust leaves the flag false.

### Tests — F-02

- DOM test: Recap Bubble primary text = candidate body, not generic "prepared"
- DOM test: source title/count visible
- DOM test: whyNow in inline hint position
- Detail: scope, localized generatedAt, coverage visible
- View action: provider call spy = 0 additional calls

### Tests — F-03

- No Modal appears for any Recap flow
- Settings `scopeRecapPreparationEnabled=true`: Recap runs without prompt
- Settings `scopeRecapPreparationEnabled=false`: Recap does not run
- First actual eligible provider call shows the shared notice once and proceeds
- Second run: no notification
- Shared first-use: after Recap notifies, Recall provider path doesn't re-notify
- Existing `pageletProviderFirstUseNotified=true` remains true after reload/upgrade
- Existing `scopeRecapPreparationEnabled=false` remains disabled
- No `scopeRecapFirstRunNotified` or feature-specific authorization field exists
- First actual call is high-risk + Run: complete blocking disclosure=1,
  non-blocking notice=0; flag changes only at the imminent invocation seam
- High-risk Cancel/passive close or Adjust that remains high-risk: provider call,
  cost reservation, and provider-trust settings mutation all remain 0
- Adjust to standard bounded: ordinary shared notice is shown once; later
  high-risk runs still require per-run confirmation after the flag becomes true

---

## Slice C: Provider Fail-Closed + Review/Preload Classification + Semantic Retrieval (F-10/F-11/F-12 / REQ-10 / AC-10)

### Design

**Files**: `src/plugin.ts`, `src/pagelet/orchestrator.ts`,
`src/pagelet/ReviewHighRiskModal.ts`, `src/pagelet/preload/PreloadEngine.ts`,
`src/pagelet/BackgroundPreparationCoordinator.ts`,
`src/settings/pagelet/index.ts`, `src/vss/vss-core.ts`

Per SG-05/SG-06 and DEC-023: shared first-use across all Pagelet provider paths;
a complete high-risk blocking disclosure may satisfy first-use when the first
actual call itself is high-risk.

1. Shared setting: `pageletProviderFirstUseNotified: boolean` (new-install
   default `false`; persisted values are preserved)

2. Before the first actual standard-envelope Pagelet provider call (Recap,
   Quiet Recall query embedding/evaluator/retry, Discover retrieval/generation), check:
   - If `!pageletProviderFirstUseNotified`: show the shared non-blocking
     notification, persist the notice-shown flag only at the imminent invocation
     seam, then proceed
   - If already notified: proceed silently

3. Fail-closed conditions (provider call = 0):
   - Provider not configured
   - Data Boundary excludes all source files
   - Feature is disabled in Settings
   - Quiet Recall has no eligible source or valid query
   - Memory/VSS index is not ready for semantic retrieval
   - Quiet Recall cooldown or existing 10/hour、50/day total budget rejects
     before cold-retrieval admission
   - Source/current-run identity changes before invocation

4. Quiet Recall keeps a pure-semantic candidate lane:
   - For an exact valid query-embedding cache miss and ready index, first check
     existing Quiet Recall total-call capacity without committing cost/accounting,
     revalidate source/current-run, and pass DEC-023 standard or high-risk
     admission. Only at the imminent invocation seam may runtime atomically
     commit one 10/50 slot and call the embedding provider, then run vector
     search and mixed ranking locally. A high-risk path commits no slot before
     affirmative `Run`, then repeats final capacity/source revalidation.
     Capacity/admission serialization must ensure there is no awaitable or
     fallible no-call gate between notice/flag, slot commit and invocation.
   - Query embedding、initial candidate evaluator 与 language retry all commit
     from the same 10/hour、50/day bucket. The evaluator stage stays at most 5
     initial calls plus 5 language retries, but receives no extra capacity after
     the retrieval call consumes a slot.
   - If vector search returns no candidates, evaluator/generation calls are 0;
     the embedding attempt and first-use notice remain consumed because a real
     provider invocation occurred.
   - Revalidate the captured source/query/Data Boundary/provider/model/current-run
     identity before every provider seam and again before accepting results.
     Post-call drift discards the result and creates no Recall/nudge.

5. Pure local Discover clues: when the Memory index is unavailable, metadata
   relations may be used only after explicit Discover. They make no provider
   call or disclosure, use "Local related clue / 本地关联线索", cannot claim
   semantic relevance, and cannot enter proactive Recall or trigger `nudge`.

6. Foreground Review builds the allowed source set first, after Data Boundary
   filtering and path de-duplication. Its risk classifier is exactly:
   `actualAllowedSources.length <= 1 ? standard : highRisk`. Requested range
   labels do not override this result: `last7` with one actual allowed source is
   standard. For `>1`, show per-run `Run / Adjust / Cancel` before reserving any
   provider quota or cost. `Adjust` must rebuild and reclassify the actual set.

7. Generic background preload runs only when the complete standard envelope is
   true: explicit opt-in; changed-only; recent 7 days; actual provider input
   `<=4K`; requested output `<=1K`; budget remains within 2 actual calls per rolling hour and 20 per local
   day; `allowWrite=false`; every actual source has a current shared Data
   Boundary `allow` decision; no whole-vault or excluded override. Do not use a
   caller-supplied `sensitiveScope=false` or keyword/AI inference as proof.
   Re-read every exact provider-bound Markdown body and deterministically
   recheck explicit body tags/frontmatter and path policy at the provider seam;
   MetadataCache lag cannot override the body, and malformed leading
   frontmatter fails closed. Accept a finding only when its `sourceFile`
   exactly matches an actual allowed input path.
   Validate the full envelope before shared first-use admission or reservation.
   Any breach returns a non-error silent skip with no blocking modal, provider
   call, quota/cost reservation, or flag mutation. Do not classify the complete
   narrow envelope as high-risk because its range is weekly/`last7`.

7a. Before any Pagelet provider input is constructed, apply the shared Pagelet
    source classifier to every actual source. For Discover/Quiet Recall cold
    retrieval this includes the primary latest body before embedding. For a
    Saved Insight, validate every distinct `sourceRef` by live read and stable
    stat; reject the whole derived text when any ref fails. Revalidate the same
    captured snapshots at admission/invocation and never synthesize a missing
    body snapshot from a fresh stat.

8. Other broad/sensitive/costly/whole-vault/out-of-envelope/excluded-override runs
   still require blocking per-use confirmation before provider call or cost
   reservation. For a first high-risk call, the blocking disclosure also
   satisfies shared first-use only when it covers allowed note excerpts/data,
   provider, possible cost, and capability opt-out. Explicit `Run` + all gates
   passed + invocation immediately next writes the shared flag without an extra
   non-blocking notice. Cancel/passive close leaves it false; Adjust repeats the
   high-risk gate or, after reducing to standard bounded, uses the ordinary
   shared notice. Later high-risk runs remain per-use confirmed.

9. The shared field is notification state only. It does not authorize Memory,
   Saved Insight, Review Queue, Markdown, vault writes, or external actions.

### Tests

- First-use: provider spy shows notification displayed + call proceeds
- Second-use: no notification, call proceeds
- Cross-feature: Recap first-use → Recall no notification
- Reload/upgrade: existing shared notice and every capability opt-out are preserved
- Provider not configured: 0 calls
- Feature disabled: 0 calls
- Data Boundary excludes all files: 0 calls
- Quiet Recall no source/query, index not ready, cooldown/budget reject, or
  pre-invocation source drift: total provider calls=0, notice=0, flag unchanged
- Pure-semantic fixture with zero tag/link/path overlap: cold embedding may
  discover a candidate, which still requires independent evaluator quality gate
- Uncached admitted semantic retrieval returns empty: embedding attempt=1,
  evaluator/generation=0, one existing 10/50 slot consumed
- Exact valid query-embedding cache hit: embedding call=0; local search and
  downstream evaluator still obey source/current-run and budget gates
- Exact query or embedding-profile/provider/model identity change misses the
  embedding cache; failed/aborted/rejected embedding attempts are not cached.
  A cache hit still reruns local search and separately revalidates current
  source/Data Boundary/run identity before any downstream provider call or use
- Source changes after embedding/evaluator returns: stale result dropped,
  Recall/nudge=0; no reuse under the old source snapshot
- Stale/null MetadataCache with a newly excluded primary body or malformed
  leading frontmatter: cold embedding/provider reservation/notice/flag all 0
- Saved Insight: all refs live-readable and allowed sends its exact text; one
  denied/missing/read-failed/drifting ref suppresses the whole Insight text,
  while another independently safe Insight can still be evaluated
- Scope preview and runtime classify Templates、node_modules、Review output、
  empty and `>100 KiB` notes consistently
- Index unavailable metadata fallback: explicit Discover local clue only,
  provider=0, semantic label=0, Recall/nudge=0
- Local Discover: 0 provider calls, local label shown
- Broad/sensitive/costly/whole-vault/out-of-envelope/excluded override:
  per-use confirmation required before provider call/cost reservation
- First actual call high-risk + Run: complete blocking disclosure=1,
  non-blocking notice=0, flag persists only at imminent call seam
- First actual call high-risk + Cancel/passive close: provider/cost/flag mutation=0
- High-risk Adjust: still high-risk repeats blocking gate with flag=false;
  reduced-to-standard uses ordinary shared notice
- Already-notified high-risk run: blocking disclosure still appears every run
- Foreground Review current actual=1 and requested `last7` actual=1: standard
  admission; no high-risk modal
- Foreground Review actual `>1`: modal before call/reservation; Cancel/passive
  close leaves provider/quota/cost/flag mutation=0; Adjust rebuilds and
  reclassifies; Run repeats final source/capacity checks before atomic reserve/call
- Generic background preload complete envelope: standard admission; a
  `weekly`/`last7` label alone does not make it high-risk
- Generic preload single-condition matrix: opt-in off, not changed-only, source
  older than 7 days, input `>4K`, output `>1K`, hourly cap hit, daily cap hit,
  `allowWrite=true`, source outside the explicit shared Data Boundary,
  whole-vault scope, and excluded override each produce silent skip with
  blocking UI/provider/quota/cost/flag mutation=0
- Generic preload budget survives plugin reconstruction and Pagelet off/on;
  local midnight resets only the daily count, while calls from the previous day
  still count in the rolling hour; unavailable/malformed storage fails closed
- Generic changed-only watermarks survive plugin reconstruction and Pagelet
  off/on; unchanged files stay excluded, a later mtime becomes eligible once,
  zero-call results do not advance watermarks, and missing/malformed storage
  access fails closed
- Stale/null MetadataCache plus a latest-body `#no-ai`, configured excluded tag,
  generated frontmatter, or malformed leading frontmatter produces zero
  provider calls; parsed findings with empty/unknown source paths are discarded

---

## Slice D: Motion + Pet State Convergence (F-04, F-06 / REQ-04,06 / AC-04,06)

### Design — F-04 Reduced Motion

**Files**: `src/custom.pcss`

Add to existing `@media (prefers-reduced-motion: reduce)` block:

```css
/* Pet animations */
.pa-pagelet-pet[data-state=idle] .pa-pagelet-pet-blink-group,
.pa-pagelet-pet[data-state=nudge] .pa-pagelet-pet-blink-group {
  animation: none;
}
.pa-pagelet-pet-dot-1, .pa-pagelet-pet-dot-2, .pa-pagelet-pet-dot-3 {
  animation: none;
}
.pa-pagelet-pet-zzz1, .pa-pagelet-pet-zzz2 {
  animation: none;
}
.pa-pagelet-pet[data-capture-hold=true]::after {
  animation: none;
}
/* Bubble motion */
.pa-pagelet-bubble {
  transition: none;
}
.pa-pagelet-bubble-context-action:hover {
  transform: none;
}
```

Preserve static state differentiation via color/opacity/icon (no `display:none`).
Touch/click/hold timers remain unchanged.

### Design — F-06 Pet State Convergence

**Files**: `src/pagelet/orchestrator.ts`

1. Introduce a `settleForForegroundOwner(routeToken)` helper that:
   - Checks if `routeToken === this.foregroundRouteToken` (still current owner)
   - If yes: transitions Pet via `analysis-done`
   - If no: does nothing (stale owner)

2. Every early-return path in `runQuietRecall()` and Recap flows that follows
   `analysis-start` must call `settleForForegroundOwner(routeToken)` in `finally`.

3. `clearQuietRecallBubbleNudge()` also resets Pet from `nudge` to `idle` if
   the cleared nudge was the only active payload.

4. Focus Mode / settings toggle paths: after clearing payloads, settle Pet to
   match remaining deliverable content (idle if nothing, nudge if another
   nudge exists).

5. Background Scope Recap preparation: use same owner-aware pattern. Start
   `working` only when no higher-priority foreground owner is active. Settle
   on completion/failure/stale/cancel.

6. Pet keeps one visual `nudge` state, but runtime keeps an explicit ticket per
   renderable owner. Recall、Recap and Pattern are the real-delivery tier;
   until they share a normalized quality score, use the deterministic
   compatibility fallback `Recap > Quiet Recall > Pattern` while preserving a
   still-current claimed owner. Onboarding is lower than every real delivery.

7. Admission and acknowledgement are separate. A source receives a ticket only
   when its own setting、quality and quiet/focus gates pass; Recap、Pattern and
   onboarding also pass the shared presentation clock, while Quiet Recall keeps
   its independent per-candidate gate and shares only quiet hours. Bubble becoming
   visible commits only that ticket's applicable once/cooldown state. Bubble close、
   action completion、work settle、settings change and source invalidation call one
   reconcile path; deferred shared tickets use one cleanup-safe wake timer.

8. Raw generic `PreloadFinding[]` has no Bubble adapter in B-118. Background
   completion caches it for the explicit Prepared Panel and always settles Pet
   through `analysis-done`; it cannot call `insights-ready` or create a ticket.
   Production exposes one explicit `Open prepared review` command that opens
   the existing `prepared` Panel route from cache with zero additional provider
   calls. The prepared route is read-only: Save and both expand-to-Tab controls
   are unavailable, the orchestration seams reject either action, and the cache
   is not promoted to current analysis. Empty cache reports no prepared
   suggestions and does not open Panel；the preflight runs before closing Bubble、
   replacing layout or clearing pending state, so an existing surface is preserved.

### Tests — F-04

- Computed animation matrix for idle/working/nudge/resting/hold/capture-hold
  under `prefers-reduced-motion: reduce`: all `animation-name: none` or
  `duration: 0s`.
- Bubble open/close: no scale/translateY under reduced motion.
- Rich action hover: no translateY displacement.
- States still visually distinguishable (color/opacity assertions).

### Tests — F-06

- Stale route return: Pet settles to idle, not stuck in working.
- Active note change during Recall: old owner's settle is ignored, new owner
  controls Pet.
- Focus Mode toggled during working: Pet settles to idle.
- Concurrent Recap nudge + Recall stale: Recap nudge preserved.
- Destroy during in-flight: no state transition after destroy.
- Background prep start/complete/fail/stale: Pet working → idle/nudge correctly.
- Recap + Quiet Recall + Pattern + onboarding producer order does not change
  the claimed owner; real delivery beats onboarding and active owner does not
  churn when a later peer arrives.
- Bubble show failure consumes no ticket; successful show commits exactly one
  owner; no remaining ticket is re-signalled until Bubble closes.
- A second already-admitted shared ticket wakes once after cooldown; new
  cooldown/quiet-hours-rejected sources stay silent. Focus、generic Off、Pet hide
  and destroy clear only the admissions/timers they own.
- Same Quiet Recall candidate with a new run timestamp remains once-only.
- Empty and non-empty raw preload cycles both settle to idle and never create a
  Bubble ticket; the production command reaches the explicit Prepared Panel,
  opens accepted cached data without a provider call, and keeps empty cache closed
  without changing an existing Bubble、Discover/Summary Panel、layout or pending object.
- Prepared Panel DOM hides and disables Save plus header/footer expand-to-Tab;
  save/expand callbacks remain no-op, while reopening an ordinary Panel restores
  its normal controls and behavior.

---

## Slice E: Quiet Recall Actions + Settings (F-05, F-07 / REQ-05,07 / AC-05,07)

### Design — F-05 Recall Actions (SG-02/03/04 resolved)

**Files**: `src/pagelet/bubble/BubbleContent.ts`,
`src/pagelet/orchestrator.ts`, `src/pa/retrieval-habit-profile.ts`,
`src/locales/pagelet/en.json`, `src/locales/pagelet/zh.json`

Per SG-02: Bubble actions = **View + Later + Dismiss**.

1. **View**: Opens Recall Detail Tab with current candidates. Does NOT re-run
   provider-backed Recall. Navigation provider rerun = 0. Change
   `handleQuietRecallBubbleView` to use existing candidates, not call
   `runQuietRecall()`.

2. **Later** (SG-04): Convert `handleQuietRecallBubbleLater` from 24h snooze
   to Review Queue entry via `quietRecallCandidateToReviewQueueInput()`.
   Remove `quietRecallSnoozedCandidateIds` Map. Record RHP feedback "later".

3. **Dismiss** (SG-03): Keep current `handleQuietRecallBubbleDismiss` behavior
   (add to `dismissedCandidateIds`, close Bubble). RHP feedback = weak signal
   on specific candidate only (`dismiss` weight stays as-is but only applied
   to exact candidate sourceRefs, not similar sources).

4. Passive close (X/Escape/outside): neutral. No dismiss, no feedback, no
   queue entry, no debt. Already implemented correctly.

5. Fix Chinese dismiss label: change "不再提醒" to match weak dismiss semantics
   (e.g., "忽略这次").

6. Fix Chinese Quiet Recall label: "安静回忆" → "相关回顾" (SG-07a).

7. Link/Save: remain in Tab only (SG-02 confirmed).

8. Stale/missing source: show honest fallback message, no silent provider re-run.

### Design — F-07 Settings (SG-01 resolved)

**Files**: `src/settings/pagelet/index.ts`, `src/settings.ts`

Per SG-01: Off/On two-tier, no frequency cap.

1. Replace internal `bubbleNudgesEnabled: boolean` with a user-facing
   `quietRecallMode: "off" | "on"` setting.

2. Canonical runtime/control source: `quietRecall.quietRecallMode` only.
   `pagelet.quietRecallMode` is a short-lived stale mirror accepted only as
   migration input and is dropped on the next save. The deprecated legacy
   boolean may remain as compatibility data but never overrides an explicit
   canonical mode or acts as a second runtime gate.

3. Migration priority: explicit canonical mode > stale Pagelet mirror > old
   `bubbleNudgesEnabled` boolean > default `"off"`. Thus legacy true maps to
   `"on"`, false maps to `"off"`, and a fully missing/invalid shape maps to
   `"off"`.

4. Settings UI: single labeled toggle in Pagelet Settings section.
   Label: "Quiet Recall / 相关回顾" with description explaining that PA will
   surface relevant old notes while writing. Mention provider usage.
   No internal jargon (VSS/RAG/proactiveHints).

5. Runtime gate: `canPrepareQuietRecallBubbleNudge()` checks
   `quietRecallMode === "on"` instead of the five-boolean chain.
   Quality gate, quiet hours, Focus Mode, per-candidate-once remain.

6. Generic `proactiveHints` parent toggle decoupled: Quiet Recall On/Off is
   independent. Scope Recap hints remain controlled by their own setting.

### Tests — F-05

- View: opens Tab with existing candidates, provider spy = 0 additional calls
- Later: creates Review Queue item via `quietRecallCandidateToReviewQueueInput`,
  `snoozedCandidateIds` not used
- Dismiss: adds to `dismissedCandidateIds`, RHP feedback only on exact candidate
- Passive close: 0 feedback, 0 queue, 0 dismiss
- RHP disabled: all feedback writes = 0
- RHP enabled: dismiss applies only to candidate sourceRefs, not similar sources
- Stale source: fallback message, provider rerun = 0
- Chinese labels: "相关回顾", "忽略这次"

### Tests — F-07

- Default setting = "off"; `canPrepareQuietRecallBubbleNudge` returns false
- Setting "on": nudge preparation proceeds
- Migration: old `{ bubbleNudgesEnabled: true }` → `quietRecallMode: "on"`
- Migration: old `{ bubbleNudgesEnabled: false }` → `quietRecallMode: "off"`
- Migration: stale `{ pagelet: { quietRecallMode } }` is absorbed only when the
  canonical field is absent; explicit canonical wins on conflict
- Migration: all fields missing/invalid → `"off"`; re-save drops the mirror
- Settings UI: toggle visible, labeled, no jargon
- Independent: changing Quiet Recall does not affect Scope Recap or generic hints

---

## Slice F: Typography + Desktop Placement (F-08, F-09 / REQ-08,09 / AC-08,09)

### Design — F-08 Typography Floor

**Files**: `src/custom.pcss`

Apply `max()` to establish ~12px floor while preserving proportional scaling:

```css
.pa-pagelet-bubble-source-link {
  font-size: max(0.6875em, 12px);  /* was 0.6875em = 9.6px at 14px */
}
.pa-pagelet-bubble-items li {
  font-size: max(0.84375em, 12px); /* was 0.84375em = 11.8px at 14px */
}
.pa-pagelet-bubble-btn-description {
  font-size: max(0.71875em, 12px); /* was 0.71875em = 10px at 14px */
}
.pa-pagelet-bubble-inline-hint,
.pa-pagelet-bubble-btn {
  font-size: max(var(--font-ui-smaller), 12px);
}
.pa-pagelet-bubble-btn-label,
.pa-pagelet-bubble-context-action-label,
.pa-pagelet-bubble-context-action-btn {
  font-size: max(var(--font-ui-small), 12px);
}
```

At 14px base: all elements ≥ 12px. At 16px/24px: proportional values take over.
Hierarchy preserved (primary > secondary > auxiliary).

### Design — F-09 Desktop Placement

**Files**: `src/pagelet/bubble/BubbleView.ts`, `src/custom.pcss`

1. In `BubbleView` placement logic, get the active Markdown leaf's content
   element bounds (via `workspace.getActiveViewOfType(MarkdownView)?.contentEl`)
   instead of using workspace overlay bounds.

2. Clamp Bubble position within leaf bounds, accounting for the Pet position.

3. Preserve Bubble tail/transform-origin relationship.

4. Only apply to desktop (non-mobile). Mobile landscape/portrait rules at
   `custom.pcss:4367-4384` must NOT be touched.

5. Track sidebar open/close and leaf resize via existing workspace events.

### Tests — F-08

- Computed font-size matrix: 14/16/24px × all target selectors ≥ 12px
- 24px: values scale up proportionally (not capped at 12px)
- Light/dark theme: contrast adequate at 12px floor

### Tests — F-09

- Right sidebar open: Bubble fully within leaf bounds
- Right sidebar closed: Bubble positioned normally
- Left sidebar open: no regression
- Split leaf: Bubble in active leaf
- Window resize: Bubble repositions
- Mobile portrait/landscape: no regression (existing rules preserved)

---

## Global Validation

### Per-Slice Gate

```bash
npm test -- --runInBand <slice suites>
npx tsc -noEmit -skipLibCheck
git diff --check
```

### Final Gate

```bash
npm test -- --runInBand
npm run lint
npm run build
make deploy
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

### Desktop Smoke

Per handoff section 9: Modal gone, Recap 3-second value, foreground Review
actual-source gate, silent background-preload skip, Pet touch/keyboard,
typography matrix, sidebar placement, reduced motion, stale state convergence.

### iPhone Smoke

Per handoff section 10: `make deploy-icloud`, four-asset byte-match, WKWebView
runtime identity, portrait touch (Capture/Review/Discover each once), landscape
QuickTime visual + Inspector DOM, iOS Reduce Motion.

Current B-118 execution disposition (2026-07-21): the user accepted landscape as
`NOT TESTED / accepted waiver`; it must not be reported as PASS. Portrait and the
remaining manual checks were user-confirmed as passing.

---

## Completion Criteria

- All B-118/REQ-01..10 addressed (F-01 through F-13).
- All B-118/AC-01..10 satisfied with automated + real surface evidence.
- SG-01~06 decisions implemented; SG-07a (Chinese label) implemented;
  SG-07b/c preserved/deferred.
- No runtime style injection, innerHTML, outerHTML.
- No uncleaned listeners/timers.
- No unauthorized provider calls.
- Tracker updated with evidence per slice.
