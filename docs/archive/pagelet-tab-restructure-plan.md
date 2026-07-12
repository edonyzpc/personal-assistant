# Pagelet Tab Restructure Plan

> **Archived 2026-07-11:** historical/evidence-only. This file no longer drives current implementation status. Follow unresolved work in [Backlog](../backlog.md) and current contracts from [docs/index.md](../index.md).

Updated: 2026-07-04

## Status

| Field | Value |
| --- | --- |
| Document type | Development plan |
| Scope | `src/pagelet/tab/TabView.ts` and related modules |
| Trigger | UI/UX audit 2026-07-03: Tab scored 2.9/5, lowest of all 8 surfaces |
| Related decisions | [UI/UX audit decisions](./pa-ui-ux-audit-report.md), [Product discussion 2026-07-02](./pa-product-discussion-2026-07-02.md) |
| Related product docs | [Low-Burden Review Principles](../product/pa-low-burden-review-product-principles.md), [Information Architecture Spec](../product/pa-product-information-architecture-spec.md) |

Implementation status (2026-07-04): core runtime work has landed and review
follow-up fixes are recorded in
[pagelet-tab-restructure-tracker.md](./pagelet-tab-restructure-tracker.md).
This plan preserves original rationale; use the tracker for current validation
state and remaining smoke gates.

## Problem Statement

TabView is the Pagelet Layer 4 ("intentional deeper review") surface. It
currently renders 9+ content sections in a 1,637-line file with 22 private
render methods, flat-scrolled with no navigation, fixed ordering regardless of
entry point, and empty-state cards for sections with no data.

Audit findings:
- 9 sections flat scroll with no navigation or priority ordering
- Entry point intent ignored (Context Pager always first)
- Empty sections render noise (empty-state cards)
- Action state management (confirm/dismiss/apply/undo) entangled with DOM
  rendering
- Weekly Review code (~213 lines) still present after product decision to
  decompose

Key insight: **most Tab opens populate only 2-4 sections**. The problem is not
"too many sections always" but noise from empties and lack of entry-point
awareness.

## Design Decisions

### Display Strategy: Smart Default Expand

| Rule | Behavior |
| --- | --- |
| Sections with data | **Default expanded** — zero extra clicks |
| Empty sections | **Completely hidden** — no empty-state cards, no DOM |
| Entry-point section | **Auto-placed first** |
| Context Pager | **Default collapsed** (`<details>`) — technical reference |
| Section nav anchors | Shown only when ≥ 3 sections have data |

Rationale: in the common case (2-3 populated sections), everything is visible
without interaction. Only Context Pager is collapsed because it is technical
provenance, not user-facing review content.

### Weekly Review: Remove

Product decision (2026-07-02) confirmed decomposition. Core capabilities
already redistributed:
- Memory candidate confirmation, including user-triggered visible-candidate
  batch confirmation → Memory Governance section
- Cross-note pattern detection → Pattern Detection section

Remove all Weekly Review rendering, state management, and locale keys.

### Code Structure: Section Renderer Extraction

Extract 3 action-heavy sections from TabView into independent modules.
TabView becomes the orchestrator that arranges and mounts sections.

## Section Inventory (Post-Restructure)

### Sections to Extract

| Section | New Module | Approx Lines | Responsibility |
| --- | --- | --- | --- |
| Memory Governance | `tab/sections/MemoryGovernanceSection.ts` | ~200 | Candidate confirm/dismiss/batch-visible confirm, confirmed record display, async action state |
| Maintenance Review | `tab/sections/MaintenanceReviewSection.ts` | ~210 | Proposal apply/undo, category overview, affected paths, async action state |
| Quiet Recall | `tab/sections/QuietRecallSection.ts` | ~155 | Link/save actions, candidate display, async action state |

### Sections to Remove

| Section | Lines Removed |
| --- | --- |
| Weekly Review rendering | ~78 |
| Weekly Review state/actions | ~135 |
| Weekly Review locale keys | EN + ZH entries |
| Weekly Review types/interfaces | WeeklyReviewUiMode, WeeklyReviewSaveStatus |

### Sections Remaining in TabView (lightweight, no extraction needed)

| Section | Lines | Reason |
| --- | --- | --- |
| Context Pager | ~50 | Read-only, simple DOM |
| Review Queue | ~72 | Read-only cards with filter buttons, no async actions |
| Saved Insights | ~30 | Read-only cards |
| Graph Discovery | ~60 | Read-only cards |
| Pattern Detection | ~68 | Read-only + client-side dismiss (no async) |
| Findings / TabSections | ~108 | Primary content rendering |
| Summary (Markdown) | ~55 | Markdown preview + save |
| Empty / Restored state | ~30 | Edge case displays |

## Section Renderer Interface

```typescript
interface TabSectionRenderer {
    /** Returns true if this section has content to display. */
    hasContent(): boolean;

    /** Render the section into the container. Called only when hasContent() is true. */
    render(container: HTMLElement): void;

    /** Re-render in place after an action changes internal state. */
    rerender(): void;

    /** Clean up DOM, listeners, and async state. */
    destroy(): void;
}
```

Each extracted section receives its data and callbacks via constructor, not
through the shared `TabViewOptions` bag.

### Rerender Lifecycle

Action callbacks (confirm/dismiss/apply/undo/link/save) live inside each
section renderer. When an action completes, the section calls a
TabView-provided `requestRerender` callback:

```
Section action handler
  → update internal state (memoryCandidateActionState, etc.)
  → call this.requestRerender()

TabView.requestRerender():
  → save bodyEl.scrollTop
  → call section.rerender() on the requesting section only
  → if section.hasContent() changed, rebuild nav anchors
  → restore bodyEl.scrollTop
```

This avoids full DOM teardown for single-section state changes while
preserving scroll position. The scroll container (`bodyEl`) is never
destroyed — only section containers within it are updated.

### Open / Recreate Contract

`TabView.open()` always destroys existing section renderers and creates new
ones from the incoming data. This matches the current full-rerender pattern
and handles the case where the orchestrator pushes updated data to an
already-open Tab via `PageletDetailView.setPayload()`.

## Entry-Point Aware Ordering

### Entry Reason Mapping

| Orchestrator Method | Entry Reason | Primary Section |
| --- | --- | --- |
| `expandPanelToTab()` | `"panel-expand"` | Findings / Summary / Discovery Layout |
| `runMaintenanceReview()` | `"maintenance"` | Maintenance Review |
| `runQuietRecall()` | `"quiet-recall"` | Quiet Recall |
| `runGraphDiscovery()` | `"graph-discovery"` | Graph Discovery |
| Pattern detection bubble view | `"pattern-detection"` | Pattern Detection |
| `runScopeRecap()` | `"scope-recap"` | Summary |
| Command / default | `"default"` | No section prioritized |

### Rendering Order Algorithm

```
1. Render primary section (based on entryReason) — always first if hasContent()
2. Render remaining sections in priority order, skip empties:
   a. Action sections: Memory Governance, Maintenance, Quiet Recall
   b. Tracking section: Review Queue (user-kept items, deferred actions)
   c. Discovery sections: Graph Discovery, Pattern Detection
   d. Reference sections: Saved Insights, Findings/TabSections
3. Render Context Pager last, inside <details> (collapsed)
4. If ≥ 3 sections rendered, prepend section nav anchors at top
5. If 0 sections rendered, show empty state
```

Note: Review Queue is classified as "Tracking" (user intent / durable
consequence), not "Discovery" (new information). Its filter tabs are
action/tracking semantics per the IA spec.

## Section Nav Anchors

When ≥ 3 sections have data, render a compact nav bar at the top:

```
[Maintenance] [Memory] [Recall] [Patterns]
```

Each anchor scrolls to its section via `scrollIntoView({ behavior: 'smooth' })`.
Nav bar is sticky (`position: sticky; top: 0`) within the scroll container.

Implementation: a horizontal flex row of small pill buttons, styled like the
existing `pa-pagelet-tab-review-queue-filter` buttons.

## Implementation Steps

### Phase 1: Section Renderer Infrastructure

1. Create `src/pagelet/tab/sections/types.ts` — `TabSectionRenderer` interface
2. Create `src/pagelet/tab/sections/MemoryGovernanceSection.ts`
   - Move `renderMemoryGovernanceContent()`, `renderMemoryCandidateItem()`,
     `confirmMemoryCandidate()`, `dismissMemoryCandidate()`, and related
     state (`memoryCandidateActionState`)
   - Constructor takes: locale, data (`PanelMemoryGovernanceState`), callbacks
3. Create `src/pagelet/tab/sections/MaintenanceReviewSection.ts`
   - Move `renderMaintenanceReviewContent()`,
     `handleMaintenanceApplyClick()`, `handleMaintenanceUndoClick()` and
     related state (`maintenanceActionStatus`)
   - Constructor takes: locale, data, callbacks
4. Create `src/pagelet/tab/sections/QuietRecallSection.ts`
   - Move `renderQuietRecallContent()`, save/link handlers and related state
     (`quietRecallActionState`)
   - Constructor takes: locale, data, callbacks

5. Add per-section unit tests alongside extraction:
   - `__tests__/tab-memory-governance-section.test.ts` — confirm/dismiss and
     user-triggered visible batch confirmation state transitions
   - `__tests__/tab-maintenance-review-section.test.ts` — apply/undo state
     transitions, proposal card rendering
   - `__tests__/tab-quiet-recall-section.test.ts` — link/save state
     transitions, candidate rendering

Test: existing pagelet-panel-tab-view integration tests still pass after
extraction. New per-section unit tests cover action state logic in isolation.

### Phase 2: Remove Weekly Review

Full dependency map (from agent team review). Organized by layer:

**Layer 1 — Core module (DELETE entirely):**
- `src/pa/weekly-review.ts` (~390 lines: types, `buildWeeklyReview()`, markdown
  generation, range calculation)
- `src/pa/index.ts` — remove re-export of `./weekly-review`
- `__tests__/weekly-review.test.ts` (~179 lines)

**Layer 2 — Tab rendering (DELETE from TabView):**
- `src/pagelet/tab/TabView.ts` — remove `renderWeeklyReviewContent()`,
  `populateWeeklyReviewActions()`, `handleWeeklyReviewSaveClick()`,
  `refreshWeeklyReviewActions()`, `resetWeeklyReviewUiState()`,
  `ensureWeeklyReviewUiState()`, `acceptedWeeklyItemIdsForReview()`,
  `saveWeeklyReviewFromTab()`, types `WeeklyReviewUiMode`,
  `WeeklyReviewSaveStatus`, `onSaveWeeklyReviewNote` from `TabViewOptions`
- `src/pagelet/tab/PageletDetailView.ts` — remove deep-copy logic and
  `onSaveWeeklyReviewNote` wiring for `weeklyReview`
- `src/pagelet/tab/types.ts` — remove `weeklyReview?: PanelWeeklyReviewState`
  from `DetailExtra`, remove `PanelWeeklyReviewState` import

**Layer 3 — Bubble nudge (DELETE):**
- `src/pagelet/bubble/BubbleContent.ts` — remove
  `buildWeeklyReviewNudgeContent()`, `WeeklyReviewNudgeOptions`
- `src/pagelet/bubble/types.ts` — remove `onWeeklyReview?: () => void`
- `src/pagelet/bubble/index.ts` — remove re-export
- `src/pagelet/index.ts` — remove re-export

**Layer 4 — Panel types (DELETE):**
- `src/pagelet/panel/types.ts` — remove `PanelWeeklyReviewState` type alias
  and `weeklyReview?` field

**Layer 5 — Orchestrator (DELETE references):**
- `src/pagelet/orchestrator.ts` — remove `weeklyReview` forwarding in
  `expandPanelToTab()` and `hasPanelContent()` check

**Layer 6 — Settings (KEEP for backward compat):**
- `src/settings.ts` — KEEP `WeeklyReviewSettings` interface and
  `mergeWeeklyReviewSettings()` (already `@deprecated`). Removing breaks
  deserialization of existing user settings.

**Layer 7 — Data compat (KEEP):**
- `src/pa/memory-governance-store.ts` — KEEP `"weekly_review"` in
  `confirmationSource` union (existing confirmed memories may carry this tag)
- `src/pa/retrieval-habit-profile.ts` — KEEP `"entry:weekly_review"` key
  (existing habit profiles may contain it)
- `src/pagelet/output/ReviewNoteGenerator.ts` — KEEP `"7":
  "pagelet-weekly-review"` filename infix (used by 7-day periodic summary,
  NOT Weekly Review feature)

**Layer 8 — Locale keys (DELETE):**
- `src/locales/pagelet/en.json` — remove `pagelet.bubble.weeklyReview.*` (3),
  `pagelet.command.weeklyReview` (1), `pagelet.tab.weekly.*` and
  `pagelet.weekly.save.*` (~14 keys)
- `src/locales/pagelet/zh.json` — same
- `src/locales/plugin/en.json` — update provider disclosure text (remove
  "weekly" reference)
- `src/locales/plugin/zh.json` — same

**Layer 9 — CSS (DELETE):**
- `src/custom.pcss` — remove `.pa-pagelet-tab-weekly-*` rules (~8 rules)

**Layer 10 — Tests (DELETE or UPDATE):**
- `__tests__/pagelet-panel-tab-view.test.ts` — remove weekly review test blocks
- `__tests__/pagelet-bubble-content.test.ts` — remove weekly review nudge tests
- `__tests__/pagelet-orchestrator.test.ts` — update test data
- `__tests__/pagelet-review-note-save-flow.test.ts` — update filenames
- `__tests__/e2e-pagelet-write.spec.ts` — update filenames
- `__tests__/pagelet-commands.test.ts` — remove weekly review command assertion

**Layer 11 — Docs (UPDATE):**
- `docs/archive/pa-weekly-review-product-spec.md` — archive (add deprecated header)
- `docs/product/pa-product-information-architecture-spec.md` — remove weekly review
  references
- `docs/product/specs/pa-active-vault-indexer-product-spec.md` — remove cross-reference

Note: `rerenderCurrentContentPreservingScroll()` is now used by ALL action
callbacks (F4 fix). It must NOT be removed.

Test: `make deploy` passes. Weekly review runtime code fully removed (settings
types and data compat fields intentionally preserved).

### Phase 3: Entry-Point Aware Layout

1. Add `entryReason` field to `TabOpenOptions` (and `PageletDetailPayload`)
2. Update orchestrator entry points to pass `entryReason`:
   - `expandPanelToTab()` → `"panel-expand"`
   - `runMaintenanceReview()` → `"maintenance"`
   - `runQuietRecall()` → `"quiet-recall"`
   - etc.
3. Refactor `renderContent()`:
   - Determine primary section from `entryReason`
   - Collect all sections with data (`hasContent()` check)
   - Sort: primary first, then action, discovery, reference
   - Render each into `bodyEl`, skipping empties
   - Wrap Context Pager in `<details>`
4. Add section nav anchors when ≥ 3 sections rendered
5. Add CSS for nav bar (`pa-pagelet-tab-nav`) and `<details>` styling

Test: open Tab from each entry point, verify primary section is first.
Verify empty sections are absent from DOM. Verify nav appears with ≥ 3 sections.

### Phase 4: Polish and Verification

1. Update `clearState()` and `destroy()` to delegate to section renderers
2. Verify scroll preservation still works with new layout
3. Verify workspace state persistence (`getState()` / `setState()`)
4. Run `make deploy` — full test + lint + build
5. Run test-vault smoke (`obsidian-test-vault-smoke`)

## Expected Outcomes

| Metric | Before | After |
| --- | --- | --- |
| TabView.ts lines | ~1,637 | ~600-800 |
| Render methods in TabView | 22 | ~10 |
| Weekly Review code | ~213 lines | 0 |
| Empty section noise | Empty cards for every section | Hidden |
| Entry-point awareness | None (fixed order) | Primary section first |
| Section navigation | None | Anchors when ≥ 3 sections |
| Action state encapsulation | All in TabView | Per-section module |

## Files Changed

### New files

| File | Content |
| --- | --- |
| `src/pagelet/tab/sections/types.ts` | `TabSectionRenderer` interface |
| `src/pagelet/tab/sections/MemoryGovernanceSection.ts` | Extracted from TabView |
| `src/pagelet/tab/sections/MaintenanceReviewSection.ts` | Extracted from TabView |
| `src/pagelet/tab/sections/QuietRecallSection.ts` | Extracted from TabView |
| `__tests__/tab-memory-governance-section.test.ts` | Unit tests for extracted section |
| `__tests__/tab-maintenance-review-section.test.ts` | Unit tests for extracted section |
| `__tests__/tab-quiet-recall-section.test.ts` | Unit tests for extracted section |

### Modified files

| File | Change |
| --- | --- |
| `src/pagelet/tab/TabView.ts` | Major refactor: extraction + layout algorithm + rerender lifecycle |
| `src/pagelet/tab/PageletDetailView.ts` | Pass entryReason; remove weekly review wiring |
| `src/pagelet/tab/types.ts` | Add entryReason; remove weekly review types |
| `src/pagelet/orchestrator.ts` | Add entryReason to payload; remove weekly review forwarding |
| `src/pagelet/panel/types.ts` | Remove `PanelWeeklyReviewState` |
| `src/pagelet/bubble/BubbleContent.ts` | Remove `buildWeeklyReviewNudgeContent` |
| `src/pagelet/bubble/types.ts` | Remove `onWeeklyReview` callback |
| `src/pagelet/bubble/index.ts` | Remove re-export |
| `src/pagelet/index.ts` | Remove re-export |
| `src/pa/index.ts` | Remove weekly-review re-export |
| `src/custom.pcss` | Add nav bar styles; remove weekly review CSS |
| `src/locales/pagelet/en.json` | Remove weekly review keys; add nav labels |
| `src/locales/pagelet/zh.json` | Same |
| `src/locales/plugin/en.json` | Update provider disclosure text |
| `src/locales/plugin/zh.json` | Same |

### Deleted files

| File | Reason |
| --- | --- |
| `src/pa/weekly-review.ts` | Core module fully removed |
| `__tests__/weekly-review.test.ts` | Tests for removed module |

### Test files updated

| File | Change |
| --- | --- |
| `__tests__/pagelet-panel-tab-view.test.ts` | Remove weekly review blocks; update for section renderers |
| `__tests__/pagelet-bubble-content.test.ts` | Remove weekly review nudge tests |
| `__tests__/pagelet-orchestrator.test.ts` | Update test data |
| `__tests__/pagelet-review-note-save-flow.test.ts` | Update filenames |
| `__tests__/e2e-pagelet-write.spec.ts` | Update filenames |
| `__tests__/pagelet-commands.test.ts` | Remove weekly review command assertion |

### Intentionally preserved (backward compat)

| File | What is kept | Reason |
| --- | --- | --- |
| `src/settings.ts` | `WeeklyReviewSettings` (`@deprecated`) | Deserialization of existing user settings |
| `src/pa/memory-governance-store.ts` | `"weekly_review"` in `confirmationSource` | Existing confirmed memories may carry this tag |
| `src/pa/retrieval-habit-profile.ts` | `"entry:weekly_review"` key | Existing habit profiles |
| `src/pagelet/output/ReviewNoteGenerator.ts` | `"pagelet-weekly-review"` filename | Used by 7-day periodic summary, not Weekly Review feature |

## Verification

- [ ] `make deploy` passes (test + lint + build)
- [ ] Each entry point opens Tab with correct primary section first
- [ ] Empty sections produce no DOM nodes
- [ ] Context Pager collapsed by default, expandable
- [ ] Section nav anchors appear when ≥ 3 sections have data
- [ ] Section nav scroll-to works smoothly
- [ ] Memory confirm/dismiss/batch-visible actions work in extracted renderer
- [ ] Maintenance apply/undo works in extracted renderer
- [ ] Quiet Recall link/save works in extracted renderer
- [ ] Weekly Review runtime code fully removed (grep returns only intentionally preserved items: settings types, confirmationSource union, habit profile key, 7-day filename infix)
- [ ] Workspace state persistence (close Tab, reopen Obsidian, Tab restores)
- [ ] Mobile: all sections readable, touch targets adequate
- [ ] `obsidian-test-vault-smoke` passes
