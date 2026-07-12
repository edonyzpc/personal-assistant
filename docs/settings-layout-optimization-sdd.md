# Settings Layout Optimization SDD

Updated: 2026-07-12

Plan: [Settings Layout Optimization Plan](./settings-layout-optimization-plan.md)

Tracker: [Settings Layout Optimization Development Tracker](./settings-layout-optimization-development-tracker.md)

## Status

| Field | Value |
| --- | --- |
| Document type | Implementation SDD |
| Design status | Complete |
| Implementation status | Iteration 2 complete: desktop progressive rail + iPhone sticky selector |
| Validation status | Focused/full/local runtime and iCloud parity complete; real-iPhone observation blocked at iPhone Mirroring unlock |
| Current authority | This SDD supersedes the navigation-layout target in historical `SDD-D13` |
| Preserved contract | Six current groups, section membership, `openGroup()` routing, and `pa-settings-collapsed` persistence |

The implementation and deployed desktop/mobile-class behavior have been
validated. The tracker records tests, review, local and iCloud deploys, runtime
smoke, and the explicit boundary between local mobile-class simulation and
real-device iOS evidence.

## 1. Objectives

1. Replace the Iteration 1 right-side text TOC with a user-approved left-side
   progressive tick rail that expands only inside a fixed reserved track.
2. Provide an in-flow native select on narrow desktop and a sticky native
   current-section selector on Obsidian Mobile.
3. Give every Settings group one body inset and every common Setting row a
   defined layout class.
4. Preserve external Settings routing, group collapse state, feature behavior,
   and user data.
5. Make navigation lifecycle-safe across `display()`, `hide()`, plugin reload,
   independent Settings windows, and mobile.

## 2. Current Architecture and Failure Mode

Before this iteration, `SettingTab.display()` rendered a horizontal
`.pa-settings-nav` before six `<details>` groups. The navigation was
`position: sticky; top: 0; z-index: 10`, while `openGroup()` and nav buttons
used `scrollIntoView({ block: "start" })`. The target summary could therefore
be placed behind the sticky bar.

Group content used a direct-child selector for padding. Because incremental
rebuild containers and direct `Setting` rows have different DOM depth, the
same visual row could receive a different outer inset. The existing
`markFormControlSettings()` recognized only input/select fields, leaving other
control types outside the shared alignment rule.

## 3. Verified Existing and Target Symbols

### 3.1 Existing contracts that must remain stable

| Symbol | Path | Contract |
| --- | --- | --- |
| `SettingTab.display()` | `src/settings.ts` | Builds the complete Settings DOM and may be called repeatedly. |
| `SettingTab.hide()` | `src/settings.ts` | Finalizes pending saves and must release UI lifecycle resources. |
| `SettingTab.openGroup(groupId, memoryTargetId?)` | `src/settings.ts` | Public routing entry used by plugin/Chat/Pagelet paths; signature must not change. |
| `SettingTab.isGroupCollapsed()` | `src/settings.ts` | Reads UI-only collapse state with graceful localStorage fallback. |
| `SettingTab.persistGroupCollapseState()` | `src/settings.ts` | Preserves `pa-settings-collapsed`; no plugin-settings migration. |
| `SettingTab.markFormControlSettings()` | `src/settings.ts` | Existing post-render layout-classification hook; may be broadened without changing callers. |
| `SettingTab.focusPendingMemoryControlCenterTarget()` | `src/settings.ts` | Moves an external Memory deep link to the exact target. |
| `.pa-settings-group` / `.pa-settings-group-summary` | `src/custom.pcss` | Existing details/summary visual and interaction contract. |

### 3.2 Implemented symbols in the local diff

| Symbol | Target role | Required lifecycle/behavior |
| --- | --- | --- |
| `settingsNavigationButtons` | Map group IDs to TOC buttons | Clear before rebuild and on hide. |
| `settingsNavigationSelect` | Compact navigation control | Keep synchronized with active group; null on cleanup. |
| `settingsGroupSummaries` | Map group IDs to scroll targets | Clear before old DOM is detached. |
| `settingsScrollRoot` / `settingsScrollHandler` | Active-group scroll synchronization | Attach once; detach from the same root on rebuild/hide. |
| `setActiveSettingsGroup()` | Update `aria-current` and select value | Must not scroll or open groups by itself. |
| `settingsScrollBehavior()` | Respect reduced motion | Return `auto` when reduced motion is requested. |
| `startSettingsNavigation()` | Resolve scroll root and attach synchronization | Must support the independent Settings window. |
| `syncActiveSettingsGroupFromScroll()` | Select the group nearest the activation line | Handle the page bottom explicitly. |
| `stopSettingsNavigation()` | Remove listener and clear element references | Called before `containerEl.empty()` and in `hide()`. |

The tracker records the validation evidence for these symbols rather than
treating source presence alone as completion.

## 4. Target DOM Contract

```text
.pa-settings-tab
  .pa-settings-shell
    h1 + byline
    .pa-settings-layout
      nav.pa-settings-toc[aria-label]
        button.pa-settings-toc-item[aria-controls][aria-expanded][aria-current]
          span.pa-settings-toc-item__tick[aria-hidden=true]
          span.pa-settings-toc-item__label
        ... six buttons total
      .pa-settings-content
        .pa-settings-jump
          label[for=pa-settings-jump-select]
          .pa-settings-jump-control
            select#pa-settings-jump-select
            span.pa-settings-jump-count[aria-hidden=true]
          .pa-settings-jump-progress[aria-hidden=true]
            span x 6
        details#pa-settings-group-<id>.pa-settings-group
          summary#pa-settings-nav-target-<id>.pa-settings-group-summary
          .pa-settings-group__body
            section headings, descriptions, Setting rows, scoped rebuild hosts
        ... six groups total
```

The TOC comes before the form in DOM reading order so keyboard and screen-reader
users can reach navigation before traversing every setting. CSS grid areas place
it in the first visual column only in wide mode. In narrow and mobile modes the
TOC is hidden and the compact select remains first within the content column.
The TOC is not a tablist:
all groups remain in the document, and `aria-current="location"` describes
scroll location rather than a mutually exclusive panel.

### 4.1 Group invariants

- IDs remain `pa-settings-group-<groupId>`.
- Summary IDs remain `pa-settings-nav-target-<groupId>`.
- Each group contains exactly one `.pa-settings-group__body`.
- Every current section renderer is called with the body wrapper.
- Group membership remains:
  - `ai-provider`;
  - `memory-personalization`;
  - `data-privacy`;
  - `features`;
  - `appearance`;
  - `system`.
- All groups still default to expanded unless the existing local collapse
  state says otherwise.

## 5. Navigation Behavior

### 5.1 Activation flow

TOC click and compact-select change share the `openGroup()` path:

```text
activate group
  -> validate and normalize group ID
  -> open target details
  -> persist expanded state
  -> update active TOC/select state
  -> scroll summary into view
  -> focus summary when no deeper target was requested
  -> update aria-expanded
```

For `openGroup("memory-personalization", targetId)`, the existing pending
Memory-target path remains authoritative. The summary must not steal final
focus from the exact target.

### 5.2 Active group from scrolling

- Resolve the actual Settings scroll root by probing the nearest
  `.vertical-tab-content`, then the outer vertical-tab container and local
  container. Choose the first candidate with real scroll extent or scrollable
  computed overflow; do not assume the outer container scrolls.
- Use an activation line `24px` below the root's top edge.
- Choose the last summary at or above that line.
- If no summary has crossed the line, choose the first group.
- When the root is within `8px` of its bottom, choose the final group.
- Updating the active state changes only `aria-current` and select value.
- Native details `toggle` events update collapse persistence and
  `aria-expanded`, but do not choose the active group. This prevents queued
  initial-open events from overriding the scroll-derived first group.

There are six groups, so a passive scroll listener with a bounded six-element
scan is acceptable. The implementation must not attach duplicate listeners
after repeated `display()` calls.

### 5.3 Focus and reduced motion

- TOC buttons are native buttons and work with Tab + Enter/Space.
- The compact control is a native labelled select.
- Navigation moves focus to the native `<summary>` after scrolling.
- Focus rings remain visible against Obsidian themes.
- Smooth scrolling is used only when the owner window does not request
  reduced motion.
- CSS transitions used for disclosure arrows must also stop under
  `prefers-reduced-motion: reduce`.

## 6. Responsive Layout Contract

The query container is `.pa-settings-tab`, named `pa-settings-tab`. Default CSS
must be the compact, non-overlapping layout so an environment without container
query support still has usable navigation. Because Obsidian otherwise caps
plugin-setting content near its narrow form width through responsive horizontal
padding, the PA scroll viewport uses a scoped `16-24px` inline gutter while a
centered `.pa-settings-shell` expands to the available pane and remains capped
at `1180px`. The cap must not be placed on `.pa-settings-tab`, because that
element is Obsidian's real scroll viewport and its scrollbar must remain at the
pane edge. The desktop padding selector deliberately matches Obsidian's
vertical-tab structure so it can override the core 700px form cap; mobile then
uses a higher-specificity, safe-area-aware `max(16px, env(...))` gutter.

### 6.1 Wide content: `min-width: 1040px`

```css
.pa-settings-layout {
  display: grid;
  grid-template-areas: "toc content";
  grid-template-columns: 184px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
```

- `.pa-settings-jump` is hidden.
- `.pa-settings-toc` is a vertical flex column in the left reserved track.
- TOC is sticky only inside its allocated track, with `top: 12px`.
- TOC has no positive z-index and does not overlay the main track.
- TOC may scroll internally only if localization or viewport height requires
  it.
- Fine-pointer environments collapse its visual inline size to `36-40px` and
  reveal labels on `:hover` or `:focus-within`; the grid track stays `184px`.
- Coarse/no-hover wide environments retain the complete labelled list.

### 6.2 Narrow desktop content: `max-width: 1039px`

- layout becomes one block column;
- side TOC is hidden;
- compact jump control is visible in normal flow;
- the select is labelled and consumes the available width without horizontal
  overflow.

### 6.3 Obsidian Mobile

- `body.is-mobile` hides the desktop rail regardless of container width;
- `.pa-settings-jump` becomes a sticky, opaque `48-52px` current-section
  selector in the real Settings scroll container;
- the actual `<select>` remains the interactive control and keeps its linked
  label; the `n/6` counter and six segments are `aria-hidden` decoration;
- active-group updates synchronize select, counter, and segments without
  changing focus;
- one lifecycle-managed `ResizeObserver` measures the rendered selector; a
  cached `--pa-settings-mobile-nav-offset` drives both the scroll activation
  line and summary scroll margin without measuring during scroll;
- portrait and landscape share the same interaction model and logical safe
  area gutters.

### 6.4 Row breakpoint: `max-width: 720px`

- field, cluster, and stacked rows use one column;
- their controls move below information and fill the available width;
- compact rows may remain `minmax(0, 1fr) minmax(44px, min(48%, 240px))`;
- multi-control clusters wrap rather than overflow;
- nested Settings remove outer logical margin and retain a small logical
  border inset;
- text/select/button controls use at least a `44px` touch target; compact toggle
  rows reserve at least `44px` of control-area height without stretching
  Obsidian's native toggle pill.

## 7. Group Body and Row Layout Contract

### 7.1 Group body

`.pa-settings-group__body` owns the only group-content gutter:

```css
box-sizing: border-box;
min-width: 0;
padding: 4px var(--pa-settings-content-gutter) 16px;
```

The previous direct-child padding selector must not coexist with the wrapper,
or dynamic subcontainers will regain double/uneven inset behavior.

### 7.2 Row classification

`markFormControlSettings()` classifies every Setting row whose control element
contains an input, select, textarea, button, or supported complex picker.

| Class | Detection | Layout |
| --- | --- | --- |
| `.pa-setting-layout--field` | Exactly one primary field | Two columns; field fills bounded right track. |
| `.pa-setting-layout--compact` | Toggle or one intrinsic control | Information plus auto-width control. |
| `.pa-setting-layout--cluster` | Multiple controls/primary fields | Wider right track with wrapping controls. |
| `.pa-setting-layout--stacked` | Textarea or complex picker | Information and control each span the full row. |

Every classified row also receives `.pa-setting-layout`. Reclassification must
remove stale modifier classes before applying the current one, because scoped
rebuilds can change a row's controls.

### 7.3 Alignment

- Setting info and control use `align-self: start`.
- The right control aligns to the setting-name line, not to the vertical center
  of a multi-line description.
- Field inputs/selects fill the field track and share a right edge.
- Compact controls remain intrinsic and right-aligned.
- Cluster controls wrap with `8px` gaps.
- Stacked complex pickers fill the row without an artificial minimum width.
- Descriptions use a consistent muted color, line height, and maximum line
  length.

## 8. Lifecycle Contract

### `display()`

1. Call `stopSettingsNavigation()` before detaching the previous DOM.
2. Clear the container and all scoped rebuild references.
3. Render header, layout, compact select, six groups, and TOC.
4. Register group toggle handlers and navigation controls.
5. Set an initial active group.
6. Attach one passive scroll listener.
7. Run row classification after all synchronous Setting rows exist.
8. Start existing Secret picker observation.

### Scoped rebuilds

Any renderer that empties and rebuilds a subtree containing standard Setting
rows must call `markFormControlSettings(rebuiltContainer)` after rebuilding.
This preserves the same row contract without a full `display()`.

### `hide()`

1. Call `stopSettingsNavigation()`.
2. Continue the existing Secret picker, generation, body-class, and pending-save
   cleanup.
3. Leave no listener referencing detached summaries or navigation controls.

## 9. Shared Resources

| Resource | Required treatment |
| --- | --- |
| `plugin.settings.nav.ariaLabel` | Reuse for the semantic TOC. |
| `plugin.settings.nav.jumpLabel` | Reuse as the visible compact-select label and accessible name. |
| Six `plugin.settings.group.*` keys | Reuse; do not rename or change membership in this iteration. |
| `src/custom.pcss` | Source of truth for Settings-scoped CSS. No runtime style elements. |
| `styles.css` | Regenerate via Tailwind/build; never patch by hand as the source of truth. |
| `pa-settings-collapsed` | Preserve as UI-only localStorage state; no migration. |

English/Chinese locale parity is required. No internal technical terminology is
introduced into ordinary UI.

## 10. Implementation Phases

### I1. Navigation and body structure — complete

- replace top horizontal nav DOM with layout/content/TOC structure;
- add compact labelled select;
- render all sections inside one group body;
- preserve IDs, collapse state, and `openGroup()`.

### I2. Active state and lifecycle — complete

- synchronize TOC/select with activation and scrolling;
- preserve exact deep-target focus;
- attach/detach one scroll listener;
- respect reduced motion.

### I3. Row alignment and responsive CSS — complete

- broaden row classification;
- add field/compact/cluster/stacked rules;
- add content-container breakpoints and mobile touch targets;
- regenerate `styles.css`.

### I4. Tests and validation — complete

- update focused DOM/CSS expectations;
- add interaction, lifecycle, exact-target, locale, and reduced-motion tests;
- run focused tests, TypeScript, lint, build, diff check, and community scan;
- run `make deploy` before runtime smoke.

### I5. Review and smoke — complete for desktop scope

- independent implementation review;
- fix and re-review until no P0-P2 findings remain;
- independent Settings-window smoke at wide, narrow, and mobile widths;
- keyboard, focus, reload, current-theme, default-theme, and horizontal-overflow
  checks;
- real-device iOS smoke before claiming mobile completion.

The deployed independent Settings window passed the wide and narrow paths,
interaction checks, reload, and runtime-error inspection. Desktop
mobile-class simulation also passed. Iteration 2 later wrote hash-matched
assets to the iCloud vault, but real-device observation is blocked at iPhone
Mirroring unlock, so this SDD does not claim real-mobile completion.

### I6. Iteration 2 rail and iPhone navigation — implementation/local validation complete

- split each TOC button into a decorative tick and real text label;
- move the fixed `184px` TOC track to the left and collapse only the TOC
  visual width on fine pointers;
- add native-select counter/progress decoration and mobile sticky styling;
- make scroll activation and summary offset share a measured, cached mobile
  sticky CSS variable and clean up its observer on rebuild/hide;
- update tests and generated CSS;
- review, deploy, run independent Settings-window smoke, then write and verify
  the build in the iCloud test vault;
- keep real-iPhone completion open until iPhone Mirroring or Safari Inspector
  can observe the native picker, touch scrolling, safe area, and orientation.

## 11. Test Contract

### DOM and semantics

- exactly six group details, summaries, TOC buttons, and select options;
- exactly one group body per group;
- semantic `<nav>` and labelled native select;
- matching `aria-controls`, `aria-expanded`, and `aria-current`;
- only one active group at a time.

### Interaction

- TOC click opens a collapsed group, persists expanded state, scrolls, and
  focuses the summary;
- select change follows the same path;
- manual scrolling updates the TOC/select;
- reaching the bottom activates System;
- reduced-motion mode requests auto rather than smooth scrolling;
- exact Memory target routing keeps final focus on the target.

### Lifecycle

- a second `display()` removes the previous scroll listener;
- `hide()` removes the current listener and clears maps/references;
- a scoped rebuild reclassifies new rows;
- missing/limited DOM APIs degrade without throwing in tests or mobile.

### Layout/CSS

- compact navigation is the default and wide TOC is container-query gated;
- the TOC has no overlay z-index;
- group body owns one gutter;
- field rows are start-aligned and bounded;
- cluster/stacked/compact modifiers exist;
- `<=720px` controls stack and touch targets reach `44px`;
- reduced-motion CSS disables disclosure transitions.

### Regression

- all existing setting controls retain values and callbacks;
- all six groups retain membership and collapse persistence;
- Secret picker, Memory deep links, provider scoped rebuilds, Metadata rows,
  and skill picker remain usable.

## 12. Real Obsidian Smoke Matrix

| Scenario | Required evidence |
| --- | --- |
| Independent Settings window, wide | Left tick rail visible; focus/hover expansion stays inside the reserved track; compact select hidden; no content shift or overlap. |
| Resize below `1040px` content width | TOC disappears; in-flow select appears; scroll position remains usable. |
| Resize below `720px` | Field/cluster rows stack; no horizontal overflow; complex rows remain readable. |
| Keyboard only | Tab reaches navigation; activation opens and focuses summary; visible focus ring. |
| Manual scroll | Active TOC/select follows group and reaches System at the bottom. |
| Reduced motion | Navigation is immediate and disclosure arrow does not animate. |
| Reload/reopen | No duplicate active updates; collapse state remains; exact Chat/Memory routing still works. |
| Mobile-class local runtime | Sticky full-width native select, 44px target, synchronized count/segments, visible target heading, and no horizontal overflow/errors. |
| Real iPhone | Native picker, touch scrolling, safe area, Dynamic Type, portrait, and landscape observed on WKWebView. |

The deployed build was observed in Obsidian for desktop wide/narrow and
mobile-class interaction smoke. The same `main.js` and `styles.css` were copied
to the iCloud test vault with matching SHA-256 hashes. Real-device iOS remains
outside the completed claim because iPhone Mirroring is locked and no USB
Safari Inspector target is connected.

## 13. Migration and Rollback

There is no data or settings-schema migration. Existing collapse-state keys and
group IDs remain unchanged.

If rollback is required:

1. restore the prior navigation DOM and CSS;
2. remove navigation listener/maps introduced by this iteration;
3. retain group details, IDs, and local collapse values;
4. regenerate `styles.css`;
5. rerun focused tests and Settings smoke.

No vault note, provider credential, Memory record, or plugin setting requires
repair.
