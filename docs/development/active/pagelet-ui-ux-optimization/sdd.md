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
Evidence handoff: [Claude Code Handoff](./handoff-claude-code.md)

## Scope

Fix 4 P1 + 5 P2 + 1 P3 confirmed by real desktop/iPhone evidence on 2026-07-19.
Preserve existing positive baselines (mobile safe area, 44×44 targets, short tap,
hold menu appearance). All SG-01~07 product decisions resolved 2026-07-20.
DEC-023 on 2026-07-21 is the current authority for SG-05/SG-06 provider
first-use behavior.

## Traceability Matrix

| Product requirement | Acceptance criterion | SDD slice |
| --- | --- | --- |
| B-118/REQ-01 | B-118/AC-01 | Slice A — Pet touch ownership |
| B-118/REQ-02 | B-118/AC-02 | Slice B — Recap first-screen value |
| B-118/REQ-03 | B-118/AC-03 | Slice B/C — shared provider notice and old Modal removal |
| B-118/REQ-04 | B-118/AC-04 | Slice D — reduced motion |
| B-118/REQ-05 | B-118/AC-05 | Slice E — Recall actions |
| B-118/REQ-06 | B-118/AC-06 | Slice D — Pet lifecycle convergence |
| B-118/REQ-07 | B-118/AC-07 | Slice E — Quiet Recall settings |
| B-118/REQ-08 | B-118/AC-08 | Slice F — typography floor |
| B-118/REQ-09 | B-118/AC-09 | Slice F — active-leaf placement |
| B-118/REQ-10 | B-118/AC-10 | Slice C — shared Data Boundary/provider trust |

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

## Slice C: Provider Fail-Closed + Shared First-Use (F-10 / REQ-10 / AC-10)

### Design

**Files**: `src/plugin.ts`, `src/pagelet/orchestrator.ts`,
`src/settings/pagelet/index.ts`

Per SG-05/SG-06 and DEC-023: shared first-use across all Pagelet provider paths;
a complete high-risk blocking disclosure may satisfy first-use when the first
actual call itself is high-risk.

1. Shared setting: `pageletProviderFirstUseNotified: boolean` (new-install
   default `false`; persisted values are preserved)

2. Before the first actual standard-envelope Pagelet provider call (Recap,
   Recall, Discover), check:
   - If `!pageletProviderFirstUseNotified`: show the shared non-blocking
     notification, persist the notice-shown flag only at the imminent invocation
     seam, then proceed
   - If already notified: proceed silently

3. Fail-closed conditions (provider call = 0):
   - Provider not configured
   - Data Boundary excludes all source files
   - Feature is disabled in Settings

4. Pure local Discover clues: no provider call, no disclosure, use
   "Local related clue / 本地关联线索" label

5. Broad/sensitive/costly/whole-vault/out-of-envelope/excluded-override runs
   still require blocking per-use confirmation before provider call or cost
   reservation. For a first high-risk call, the blocking disclosure also
   satisfies shared first-use only when it covers allowed note excerpts/data,
   provider, possible cost, and capability opt-out. Explicit `Run` + all gates
   passed + invocation immediately next writes the shared flag without an extra
   non-blocking notice. Cancel/passive close leaves it false; Adjust repeats the
   high-risk gate or, after reducing to standard bounded, uses the ordinary
   shared notice. Later high-risk runs remain per-use confirmed.

6. The shared field is notification state only. It does not authorize Memory,
   Saved Insight, Review Queue, Markdown, vault writes, or external actions.

### Tests

- First-use: provider spy shows notification displayed + call proceeds
- Second-use: no notification, call proceeds
- Cross-feature: Recap first-use → Recall no notification
- Reload/upgrade: existing shared notice and every capability opt-out are preserved
- Provider not configured: 0 calls
- Feature disabled: 0 calls
- Data Boundary excludes all files: 0 calls
- Local Discover: 0 provider calls, local label shown
- Broad/sensitive/costly/whole-vault/out-of-envelope/excluded override:
  per-use confirmation required before provider call/cost reservation
- First actual call high-risk + Run: complete blocking disclosure=1,
  non-blocking notice=0, flag persists only at imminent call seam
- First actual call high-risk + Cancel/passive close: provider/cost/flag mutation=0
- High-risk Adjust: still high-risk repeats blocking gate with flag=false;
  reduced-to-standard uses ordinary shared notice
- Already-notified high-risk run: blocking disclosure still appears every run

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

2. Default: `"off"` (fail closed).

3. Migration: old `bubbleNudgesEnabled: true` → `"on"`;
   old `bubbleNudgesEnabled: false` or missing → `"off"`.

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
- Migration: missing field → `"off"`
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

Per handoff section 9: Modal gone, Recap 3-second value, Pet touch/keyboard,
typography matrix, sidebar placement, reduced motion, stale state convergence.

### iPhone Smoke

Per handoff section 10: `make deploy-icloud`, four-asset byte-match, WKWebView
runtime identity, portrait touch (Capture/Review/Discover each once), landscape
QuickTime visual + Inspector DOM, iOS Reduce Motion.

---

## Completion Criteria

- All B-118/REQ-01..10 addressed (F-01 through F-10).
- All B-118/AC-01..10 satisfied with automated + real surface evidence.
- SG-01~06 decisions implemented; SG-07a (Chinese label) implemented;
  SG-07b/c preserved/deferred.
- No runtime style injection, innerHTML, outerHTML.
- No uncleaned listeners/timers.
- No unauthorized provider calls.
- Tracker updated with evidence per slice.
