# Settings Layout Optimization Plan

Updated: 2026-07-12

SDD: [Settings Layout Optimization SDD](./settings-layout-optimization-sdd.md)

Tracker: [Settings Layout Optimization Development Tracker](./settings-layout-optimization-development-tracker.md)

Related framework: [PA UI/UX Review Framework](../development/workflows/pa-ui-ux-review-framework.md)

## Status

| Field | Value |
| --- | --- |
| Document type | UI/UX optimization plan |
| Design status | Complete |
| Implementation status | Iteration 2 complete: desktop rail + iPhone sticky selector |
| Validation status | Automated and local runtime complete; iCloud asset parity passed; real-iPhone observation blocked at iPhone Mirroring unlock |
| Trigger | User-reported Settings navigation overlap and repeated section alignment problems |
| Product standard | “安静且可信” from [PA Product North Star](../product/pa-product-north-star.md) |
| Supersedes | The navigation-layout portion of `SDD-D13` in the historical [PA UI/UX Optimization Plan](./pa-ui-ux-optimization-plan.md) |

The existing six Settings groups and their persisted collapse state remain
valid. This iteration replaces the sticky horizontal jump bar and standardizes
group-body and setting-row layout. It does not reopen Settings product
semantics or change any saved setting.

## 1. Problem Statement

The current Settings surface has two systemic presentation problems.

### 1.1 Navigation overlaps content

The current horizontal navigation is sticky at the top of the Settings scroll
container. Group navigation calls `scrollIntoView({ block: "start" })`, but the
target summaries do not have a matching sticky-height offset. The resulting
group title can land under the navigation bar. Long labels also turn the bar
into a horizontally scrolling control at narrower widths.

### 1.2 Rows do not share one alignment system

The current group padding is applied to each direct child. Direct `Setting`
rows and `Setting` rows inside incremental-rebuild containers therefore receive
different nesting and inset behavior. The form-control layout also applies to
only a subset of controls, while buttons, toggles, Secret components, complex
pickers, and multi-control rows retain different native flex behavior.

The visible symptoms are:

- section and row edges do not consistently share one content line;
- controls in adjacent rows end at different horizontal positions;
- multi-line descriptions vertically center a control below the setting name;
- narrow layouts compress multi-control rows before switching to a stacked
  layout;
- nested sections lose too much width on mobile.

## 2. Product Goal

Make Settings feel stable, calm, and native to Obsidian:

1. Navigation never covers the content it targets.
2. The current section remains easy to locate without demanding attention.
3. Every common setting row follows a predictable alignment system.
4. The same information architecture works in an independent Settings window,
   a resized desktop window, and mobile.
5. Keyboard, reduced-motion, and screen-reader users receive an equivalent
   navigation contract.

This supports the North Star by reducing management friction and avoiding
surprising or visually noisy controls.

## 3. Locked Design Decisions — Iteration 2

The user-provided Codex rail reference supersedes the Iteration 1 right-side
text TOC. The earlier non-overlap, accessibility, and container-width
contracts remain mandatory.

### 3.1 Wide layout: left-side progressive rail

When the PA Settings content area is at least `1040px` wide:

- keep Obsidian's full-width scrolling viewport, replace its width-dependent
  horizontal padding with a scoped `16-24px` gutter, and center a dedicated PA
  content shell capped at `1180px`;
- reserve the existing `184px` navigation track on the left of the PA content;
- keep `24px` between the reserved track and Settings content;
- default to a quiet `36-40px` visible rail for fine-pointer environments;
- use one `44px` native button per group with a short tick; make the current
  tick longer and darker so state is not communicated by color alone;
- expand the navigation to its full reserved width on `:hover` or
  `:focus-within`, revealing the six existing group labels;
- keep expansion entirely inside the reserved track so content position and
  width do not change and no label overlays the form;
- retain a fully labelled `184px` list for `hover:none` or `pointer:coarse`
  wide environments rather than exposing an unreadable tick-only rail.

This is not a second full left navigation hierarchy. Obsidian's sidebar remains
the primary Settings owner; the PA rail is a quiet in-page location indicator.
It adds no count, badge, preview, queue, or persistent expanded state.

### 3.2 Narrow desktop: in-flow native select

Below `1040px` of PA content width:

- hide the side TOC;
- show a labelled native select before the first group;
- keep it in normal document flow, not sticky or floating;
- make it full width up to the available content width;
- synchronize its value with the active group;
- selecting a group opens it and moves to its summary.

The breakpoint must use the PA Settings content container, not the whole app
viewport. Obsidian's native left navigation and independent-window resizing
make viewport-only breakpoints unreliable.

### 3.3 iPhone and Obsidian Mobile

For `body.is-mobile`, never render the desktop rail as the usable navigation.
Upgrade the native select into a sticky current-section selector:

- keep one real labelled `<select>` with six complete options so WKWebView,
  VoiceOver, and external keyboards retain platform behavior;
- use a `48-52px` minimum-height sticky control in the real Settings scroll
  container, with an opaque Settings background and quiet border/shadow;
- show the current group through the select, plus an `aria-hidden` `n/6`
  counter and six-segment position rail;
- keep the visible label visually hidden on mobile but associated through
  `for`/`id`; do not duplicate it with `aria-label`;
- update the counter and segments during passive scrolling without moving
  focus or announcing an `aria-live` message;
- measure the sticky control with one lifecycle-managed `ResizeObserver` and
  share a cached CSS-variable offset between the scroll activation line and
  summary scroll margin so navigation never hides the target heading;
- keep a minimum `44px` touch target and existing logical safe-area gutters;
- use the same selector in portrait and landscape and never introduce hidden
  long-press, drag, or hover interactions.

At `720px` content width or below, and for `body.is-mobile`, row layout still:

- stack field, cluster, and intentionally stacked rows;
- retain a compact `1fr auto` pattern for simple toggle/button rows where it
  remains readable;
- give the select, summaries, fields, and buttons a minimum `44px` touch target,
  and reserve `44px` control-area height for native toggles without deforming
  the toggle pill;
- remove nested-section outer margins, keep a small logical inset, and preserve
  at least `16px` or the platform safe area at the pane edge;
- never introduce horizontal scrolling.

### 3.4 Rejected alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| Repaired sticky horizontal bar | Rejected as the final design | Scroll offsets can prevent direct overlap, but the bar still permanently consumes vertical space and long labels still require horizontal navigation. |
| Hover-only or overlay navigation | Rejected | The desktop rail must also expand on keyboard focus, remain named to assistive technology, and stay inside a reserved track. |
| Desktop rail on iPhone | Rejected | Tick labels cannot remain both understandable and comfortably tappable in the compact viewport. |
| Horizontal mobile chips | Rejected | Six localized labels create clipping or hidden horizontal scrolling under Dynamic Type. |
| Custom mobile bottom sheet | Rejected for this iteration | A native select already supplies the required menu, cancellation, VoiceOver, and keyboard behavior with less lifecycle risk. |
| Right-side text TOC | Superseded by the user-approved Iteration 2 design | It solved overlap but did not match the requested quiet location rail or reading path. |

## 4. Alignment System

### 4.1 One group-body inset

Each `<details>` group receives one `.pa-settings-group__body` wrapper. Every
section renderer receives that wrapper as its parent.

- desktop horizontal gutter: `clamp(12px, 2vw, 20px)`;
- body block padding: approximately `4px` top and `16px` bottom;
- section heading, description, and setting-card outer edges share this one
  body inset;
- do not apply padding independently to every direct child of `<details>`.

### 4.2 Row classes

All non-empty `.setting-item-control` rows participate in the shared layout,
not only input/select rows.

| Row type | Intended controls | Wide behavior |
| --- | --- | --- |
| `field` | One text/number/select field | Two-column grid; control fills the right column |
| `compact` | Toggle or one intrinsic-width button | `1fr auto`; control aligns with the setting-name line |
| `cluster` | Multiple related controls | Wider right column; controls wrap with an `8px` gap |
| `stacked` | Textarea, skill picker, or deliberately full-width complex UI | Information first, control below at full width |

The field track should be approximately `minmax(240px, min(44%, 520px))`.
Controls use `align-self: start`; descriptions may wrap below the name without
pulling the control down to the vertical center of the full text block.

### 4.3 Visual rhythm

- use logical properties so RTL and platform direction remain possible;
- normalize section descriptions to one muted color, `1.5` line height, and a
  readable maximum line length;
- keep section headings and row containers on the same outer alignment line;
- align input/select right edges across a section;
- keep intrinsic buttons right-aligned without stretching their labels;
- treat genuinely multi-control rows as clusters instead of forcing them into
  the single-field width.

## 5. Interaction Contract

1. A TOC button or compact-select change opens the target group.
2. The target summary is fully visible with at least `12-16px` top breathing
   room; no navigation element can cover it.
3. Navigation activation moves keyboard focus to the summary.
4. Existing deep links through `SettingTab.openGroup(groupId,
   memoryTargetId?)` keep their public signature and continue focusing the
   exact Memory target when one is provided.
5. Manual scrolling updates TOC `aria-current` and the compact select.
6. At the bottom of the scroll area, the final group becomes active.
7. Smooth scrolling is disabled when `prefers-reduced-motion: reduce` matches.
8. Group collapse continues to use `pa-settings-collapsed`; no settings-data
   migration is introduced.

## 6. Scope

### In scope

- `src/settings.ts` navigation DOM, scroll synchronization, focus, cleanup,
  group-body wrapper, and row classification;
- `src/custom.pcss` responsive layout and Settings-scoped alignment rules;
- generated `styles.css`;
- existing Settings navigation locale strings in English and Chinese;
- `__tests__/settings.test.ts` and locale parity tests;
- wide, narrow, keyboard, and mobile Settings smoke evidence;
- documentation and supersession links.

### Out of scope

- changing the six group labels or section membership;
- changing setting values, defaults, persistence, or provider behavior;
- replacing Obsidian's native Settings sidebar;
- adding Settings search;
- making group headers sticky;
- introducing badges, unresolved counts, or review queues;
- redesigning Memory Control Center content or other feature semantics;
- extracting all section renderers into a new component framework.

## 7. Phased Roadmap

### Phase 0: Design and source mapping — Iteration 1 history

Status: complete.

Deliverables:

- screenshot-led overlap analysis;
- three-option navigation comparison;
- historical right-side TOC and compact-select decision;
- current `SettingTab`/CSS dependency map;
- plan, SDD, and tracker.

### Phase 1: Navigation structure — Iteration 1 history

Status: complete.

Deliverables:

- responsive layout wrapper;
- historical right-side semantic TOC, superseded by Iteration 2;
- in-flow compact select;
- group-body wrapper;
- shared navigation helper and active-state synchronization;
- cleanup on `display()` rebuild and `hide()`.

### Phase 2: Alignment normalization

Status: complete.

Deliverables:

- field/compact/cluster/stacked classification;
- start-aligned information and controls;
- consistent group/section/row gutters;
- narrow and mobile stacking rules;
- nested-section width recovery.

### Phase 3: Automated validation

Status: complete.

Deliverables:

- focused Settings DOM, interaction, lifecycle, CSS, and locale tests;
- TypeScript, lint, build, whitespace, and community DOM scan;
- generated stylesheet parity.

### Phase 4: Review and real Obsidian smoke

Status: complete for desktop and local mobile-class coverage. Real-device iOS
remains a separately identified follow-up and is not claimed.

Deliverables:

- independent code review with no open P0-P2 findings;
- deployed independent-Settings-window smoke at wide and narrow widths;
- keyboard/focus and reduced-motion checks;
- mobile-width smoke and real-device iOS evidence before mobile completion is
  claimed.

### Phase 5: Closeout

Status: complete for the requested desktop Settings scope.

Deliverables:

- tracker evidence and risk table match actual runtime behavior;
- current Settings docs link to the new authority;
- no historical sticky-nav text is presented as the current target.

### Iteration 2 follow-up

Status: implementation, automated validation, review, local deployed smoke, and
iCloud deployment complete. Real-iPhone visual/touch observation is blocked
until iPhone Mirroring is unlocked.

Deliverables:

- left-side reserved desktop tick rail with focus-equivalent expansion;
- no content movement or overlap while the rail expands;
- sticky native iPhone selector with current-position counter and segments;
- mobile-aware scroll activation and summary offset;
- focused tests, Agent Team review, local deployed smoke, and iCloud hash
  verification are complete;
- real-device iOS evidence remains required before mobile completion is
  claimed.

### Completion evidence

- Final focused Settings validation: `167/167` tests passed.
- Final `make deploy` and `make deploy-icloud`: `155/155` suites and
  `2908/2908` tests passed, followed
  by lint, TypeScript, Tailwind, production build, and test-vault deployment.
- `git diff --check`, generated/local/iCloud asset SHA-256 parity, and the community
  DOM source scan passed.
- The deployed independent Settings window passed the wide left rail in both
  collapsed and keyboard-expanded states; the content rect remained exactly
  `x=493, width=972` in both states.
- A desktop mobile-class simulation passed the sticky native selector,
  `44px` target, `5/6` state synchronization, approximately `12px` heading
  clearance, and zero horizontal overflow. This is not presented as
  real-device iOS evidence.
- Three independent Agent Team reviewers reported no actionable P0-P3 finding
  after the final fixes.
- Fresh Obsidian runtime error capture reported no errors.

## 8. Acceptance Criteria

- No navigation element overlaps any group summary or setting row.
- Wide fine-pointer Settings shows a left tick rail that expands within its
  reserved track; narrow desktop Settings shows an in-flow select;
  never both at once.
- Obsidian Mobile shows a sticky native selector and never exposes the desktop
  rail as its usable navigation.
- All six groups remain reachable and retain collapse persistence.
- The active group is correct after click, select change, manual scroll, and
  reaching the bottom.
- External `openGroup()` Memory routing remains exact.
- Adjacent single-field rows share a right edge and align controls to the
  setting-name line.
- Multi-control and picker rows do not overflow.
- Narrow/mobile Settings has no horizontal overflow, all required touch
  targets are at least `44px`, and target headings remain visible below the
  sticky selector.
- Navigation works with keyboard alone and exposes correct `nav`, label,
  `aria-controls`, `aria-expanded`, and `aria-current` semantics.
- Repeated display/hide/reload cycles do not retain scroll listeners or stale
  element maps.
- Runtime completion is claimed only after `make deploy`, independent-window
  Obsidian smoke, and review/fix/re-review are complete.

## 9. Risks

| Risk | Impact | Planned mitigation |
| --- | --- | --- |
| Wrong scroll root in an independent Settings window | Active state stops following the visible content | Resolve the nearest actual Settings scroll container and smoke in the separate window. |
| Listener survives a full `display()` rebuild | Duplicate updates or stale DOM references | Stop navigation before `containerEl.empty()` and again in `hide()`. |
| Responsive rail leaves too little form width | Row wrapping regresses at intermediate sizes | Use content-container breakpoint and compact-select fallback below `1040px`. |
| Generic layout breaks complex Setting rows | Metadata or picker controls overflow | Classify field, compact, cluster, and stacked rows; test representative examples. |
| Deep-link focus regresses | Chat/Pagelet Memory routes land on the wrong element | Preserve the public `openGroup()` contract and add exact-target tests. |
| Theme-specific native styles override alignment | Current theme still appears uneven | Keep selectors scoped to `.pa-settings-tab` and smoke the current theme plus Obsidian default. |

## 10. Rollback

This is a DOM/CSS-only migration with no settings schema or user-data change.
Rollback restores the previous navigation/container markup and generated CSS
while retaining the existing six groups and `pa-settings-collapsed` values.
No data repair or vault mutation is required.
