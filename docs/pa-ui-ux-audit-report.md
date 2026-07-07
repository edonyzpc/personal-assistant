# PA UI/UX Design Audit Report

Audit Date: 2026-07-03
Framework: [PA UI/UX Review Framework](./pa-ui-ux-review-framework.md)

## Status

| Field | Value |
| --- | --- |
| Document type | Design audit report |
| Scope | All 8 PA user-facing surfaces |
| Product version | v2.8.x (post-Pagelet v2 redesign) |
| North Star | 随手记下，需要时自然浮现 |
| Design Philosophy | 安静且可信 |

Current status note (2026-07-07): this is the v1 baseline audit. A v2 refresh
audit was conducted 2026-07-07, scoring overall quality at 3.97/5.0 (up from
3.71). 81 findings identified, 62 confirmed. 15 product decisions made. The
implementation plan is in
[pa-ui-ux-optimization-plan.md](./pa-ui-ux-optimization-plan.md). Key
improvements since baseline: Statistics +0.88 (dark mode fixed), Tab +0.62
(restructured), Chat +0.31 (i18n partially migrated). Panel regressed -0.15
(scope controls added management burden). The v2 heatmap and findings are in
the optimization plan document.

---

## 1. Score Heatmap

### 1.1 Surface × Dimension Matrix (1-5 scale)

| Dimension | Pet | Bubble | Panel | Tab | Chat | Statistics | Settings | Modals | Avg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1 Coherence** | 4.5 | 4.5 | 4 | 3 | 3.5 | 2.5 | 3.5 | 3.5 | **3.6** |
| **A2 Polish** | 4 | 4.5 | 4 | **2** | 4 | **3** | 3.5 | 3.5 | **3.6** |
| **A3 Interaction** | 4.5 | 4.5 | 4 | 3 | 4 | 3 | 3.5 | 3.5 | **3.8** |
| **A4 Clarity** | 3.5 | 4 | 4 | 4 | **3** | 3.5 | 3.5 | 3.5 | **3.6** |
| **B1 Quietness** | 4 | 5 | 4 | **2** | 3.5 | 3.5 | 3.5 | 3.5 | **3.6** |
| **B2 Trust** | 5 | 4.5 | **5** | 4 | 4 | 3 | 4 | 4 | **4.2** |
| **B3 Capture** | 3.5 | **3** | 4 | 3 | — | — | 4 | 4 | **3.6** |
| **B4 Return** | 4.5 | 4.5 | 3 | 3 | 3.5 | — | — | — | **3.7** |
| **B5 Burden** | **5** | 4 | 4 | **2** | 3.5 | 3.5 | 3 | 3.5 | **3.6** |
| **B6 Disclosure** | **5** | 4.5 | **5** | 3 | 4 | **2.5** | 3.5 | 3.5 | **3.9** |
| **Surface Avg** | **4.4** | **4.3** | **4.1** | **2.9** | **3.7** | **3.1** | **3.6** | **3.6** | |

### 1.2 Key Observations

**Strongest surfaces**: Pet (4.4), Bubble (4.3), Panel (4.1) — Pagelet L1-L3
display mature design quality and strong North Star alignment.

**Weakest surfaces**: Tab (2.9), Statistics (3.1) — Tab has systemic issues
with burden and polish; Statistics is visually alien.

**Strongest dimension**: B2 Trustworthiness (4.2) — source evidence, preview,
and undo are consistently well-implemented across surfaces.

**Weakest dimensions**: A2 Visual Polish (3.6 avg, but Tab=2 and Stats=3 drag
it down), B1 Quietness (3.6 avg, Tab=2 is the outlier).

---

## 2. Critical Findings (P0) — Must Fix Before Next Release

### P0-1: Tab has 33 CSS classes with no style definitions

**Surface**: Tab
**Dimensions**: A2 Visual Polish
**Evidence**: `TabView.ts` applies 33 CSS classes (e.g., `pa-pagelet-tab-memory-confirm`,
`pa-pagelet-tab-recall-link`, `pa-pagelet-tab-pattern-dismiss`,
`pa-pagelet-tab-source-link`) that have zero
corresponding rules in `custom.pcss`. Interactive elements (confirm/dismiss
buttons, source links, pattern dismiss) render as unstyled browser-default
elements.

**Impact**: Users see raw unstyled buttons and links in the Tab view. This is
the largest single visual quality gap.

**Fix**: Add style definitions for all missing classes, or consolidate into
fewer shared utility classes. Priority classes: interactive buttons
(`*-confirm`, `*-dismiss`, `*-link`) and cards (`*-card`).

### P0-2: Tab violates "no queues" product constraint

**Surface**: Tab
**Dimensions**: B5 Burden, B1 Quietness
**Anti-pattern**: AP7 Queue/badge creep, AP9 Obligation language
**Evidence**:
- Review queue has 5 lifecycle filter tabs: `needs_decision`,
  `ready_to_apply`, `recently_applied`, `snoozed`, `stale`
  (TabView.ts:1356-1373)
- Memory governance copy: "{count} memory candidates are waiting for your
  decision" (en.json L443)
- Per-pattern "Dismiss" buttons create dismiss-chore
- Multiple sections show counts that accumulate like outstanding work

**Impact**: Directly contradicts North Star design constraints "Do not create
queues, badges, or unresolved states for every AI candidate" and "Review should
feel like recognition, not administration."

**Fix**: Rethink the review queue as a read-only "Browse past insights" view.
Remove lifecycle filter tabs. Reword memory candidates copy to optionality
language (e.g., "You may want to review {count} memory suggestions").

### P0-3: Statistics broken in dark mode

**Surface**: Statistics
**Dimensions**: A1 Coherence, A2 Polish
**Anti-pattern**: Cross-surface visual inconsistency
**Evidence**: `Statistics.tsx` uses Tailwind utility classes with hardcoded
light-mode colors (`pa-bg-white`, `pa-bg-slate-50`, `pa-text-slate-900`,
`color: "rgb(51, 65, 85)"` for chart legends, `color: "rgb(71, 85, 105)"`
for axis ticks). In dark Obsidian themes, the dashboard renders as a bright
white panel while every other surface respects the theme.

**Impact**: Plugin looks like two separate products in dark mode.

**Fix**: Replace all Tailwind utility classes and hardcoded RGB values with
Obsidian CSS variables (`var(--background-primary)`, `var(--text-normal)`,
`var(--background-modifier-border)`, etc.).

### P0-4: Jargon leaks through Chat formatters

**Surface**: Chat
**Dimensions**: A4 Content Clarity
**Anti-pattern**: AP8 Jargon leakage
**Evidence**: `formatters.ts` surfaces internal vocabulary to users:
- "Reading vault context...", "Searching vault metadata..." (L83-93)
- "Memory search", "budget exceeded", "Duplicate read-only tool call skipped"
  (L227-278)
- `formatRuntimeWarningType()` falls back to showing raw enum strings:
  "required_capability_missing", "provider_partial_error",
  "assistant_idle_timeout" (L340-370)

**Impact**: Violates the design constraint "Do not expose RAG, GraphRAG, VSS,
agent, or memory jargon as product concepts."

**Fix**: Rewrite all user-facing strings in `formatters.ts`. Replace "vault"
→ "notes"/"your notes", "memory" → "related notes"/"past notes", remove raw
enum fallbacks in `formatRuntimeWarningType()` (provide human-readable
messages for all cases).

---

## 3. Important Findings (P1) — Fix in Current Version

### P1-1: Quick Capture has zero visual discoverability

**Surface**: Pet
**Dimensions**: A3 Interaction, B3 Capture Friction
**Evidence**: Long-press (520ms) and Shift+Enter trigger Quick Capture from
Pet, but there is no visual affordance: no tooltip, no hold animation, no
onboarding hint. `data-capture-hold` attribute is set (PetView.ts:341) but
no CSS targets it. Users cannot discover this feature without documentation.

**Fix**: Add CSS for `[data-capture-hold="true"]` (gentle scale-up or ring
glow). Consider adding Quick Capture to the onboarding bridge nudge sequence.

### P1-2: Tab omnibus dashboard still needs progressive disclosure polish

**Surface**: Tab
**Dimensions**: A1 Coherence, B6 Progressive Disclosure
**Status update (2026-07-04)**: Section navigation now exists when 3+ sections
render, entry-relevant sections render first, and Context Pager is collapsed.
Remaining work is lower-priority progressive disclosure polish, not a missing
navigation blocker.

**Evidence**: `renderContent()` (TabView.ts:243-321) renders up to 9
independent sections (context pager, review queue, saved insights, memory
governance, maintenance review, graph discovery, pattern detection, weekly
recall) in a long scroll surface.

**Fix**: Add collapsible `<details>` sections (default-collapsed for lower-
priority sections). Consider section navigation anchors at the top. Show
only sections with content; suppress empty sections entirely rather than
showing empty-state cards for every section.

### P1-3: Tab full DOM re-render causes scroll position loss

**Surface**: Tab
**Dimensions**: A3 Interaction
**Status update (2026-07-04)**: Extracted Memory/Maintenance/Quiet Recall
action state is now shared from `TabView`, so full rerenders no longer drop
pending async action completions. Keep this finding open only for additional
visual scroll-position smoke.

**Evidence**: Most Tab actions call `this.renderContent(this.currentContent,
this.currentOptions)` (TabView.ts:700, 746, 939, 975, 1167, 1264, 1301,
1325), rebuilding the entire DOM. If a user confirms a memory candidate deep in
the scroll, they can lose their position.

**Fix**: Apply the `rerenderCurrentContentPreservingScroll()` pattern to all
action callbacks, or implement per-section re-rendering.

### P1-4: Memory batch confirmation requires a user-triggered boundary

**Surface**: Tab
**Dimensions**: B2 Trustworthiness
**Anti-pattern**: AP6 Clickworker safety
**Status update (2026-07-04)**: Product decision: batch confirmation is allowed
because Memory review itself is a burden. The action is user-triggered,
limited to currently visible candidates, and prompts before confirming.

**Fix**: Keep the batch action low-friction but explicit; do not silently admit
Memory candidates in the background.

### P1-5: Chat thinking status creates visual noise

**Surface**: Chat
**Dimensions**: B1 Quietness
**Evidence**: Thinking status loader cycles through 5 colors at 3s
continuously (custom.pcss:1153-1170). During long responses (30+ seconds),
this creates persistent peripheral visual noise. Up to 6 activity detail
items + 12 context-used items can display in the expanded details, with no
progressive disclosure within.

**Fix**: Replace 5-color cycling with a single muted accent color. Add
summary-first approach to context-used (e.g., "3 notes consulted") with
drill-down.

### P1-6: Settings has 16 sections without navigation

**Surface**: Settings
**Dimensions**: B5 Burden, B6 Progressive Disclosure
**Evidence**: settings.ts:936-954 renders 16 top-level sections in a single
scrolling page with no collapsing, sidebar navigation, or search.

**Fix**: Add section collapsing (matching Obsidian's native settings pattern).
Consider hiding sections that don't apply to the current configuration.

---

## 4. Improvement Findings (P2) — Fix in Next 1-2 Versions

| # | Surface | Finding | Suggestion |
| --- | --- | --- | --- |
| P2-1 | Pet | Mobile resting state forces `opacity: 1` (PetAnimations.css L441-448), removing quietness signal | Apply lighter dimming on mobile (e.g., `opacity: 0.85`) |
| P2-2 | Pet | "Pagelet" used in EN aria-labels/copy; ZH correctly uses "拾页" | Replace "Pagelet" with PA product name in EN strings |
| P2-3 | Bubble | Quiet Recall nudge has 4 action buttons — decision fatigue for a "doorway" | Reduce to 2-3 actions; merge Dismiss/Later |
| P2-4 | Bubble | No capture affordance despite "capture lightly" North Star | Add compact Quick Capture button in empty/quick-review Bubble |
| P2-5 | Bubble | Nudge findings may lack source links when preload has no sourceFile | Add "(unsourced)" indicator for AI-only findings |
| P2-6 | Panel | Quiet recall section borrows Tab locale keys — verbose for 380px panel | Add Panel-specific recall locale keys |
| P2-7 | Panel | Scope controls checkbox-list feels like management | Make scope controls `<details>` collapsed by default |
| P2-8 | Chat | Three different border-radius values (8/12/14px) across sub-components | Define a radius scale and apply consistently |
| P2-9 | Chat | CSS class naming mixes `llm-*` and `pa-chat-*` conventions | Migrate `llm-*` to `pa-chat-*` |
| P2-10 | Chat | Runtime warnings buried in collapsed details; important warnings invisible | Surface critical warnings on the message itself |
| P2-11 | Statistics | Tab grid (2×2) on mobile is non-standard for tab navigation | Use horizontal scrolling tabs on narrow viewports |
| P2-12 | Statistics | Range picker only appears for Daily/Growth but not Overview | Add range picker to Overview or explain the difference |
| P2-13 | Settings | Data Boundary cleanup buttons all "Unavailable" with no explanation | Hide them or explain prerequisites |
| P2-14 | Modals | Quick Capture Escape=preserve vs Cancel=discard asymmetry | Make behavior consistent, or show a toast on Escape-preserve |

---

## 5. Refinement Findings (P3) — Backlog

| # | Surface | Finding |
| --- | --- | --- |
| P3-1 | Pet | SVG 52px inside 56px wrapper — implicit 2px gap |
| P3-2 | Pet | "Pagelet is watching." (EN) has surveillance connotation |
| P3-3 | Bubble | Items `padding-right: 42px` is a magic number coupled to close button |
| P3-4 | Bubble | `touchmove` no-op listener registered but unused |
| P3-5 | Bubble | Onboarding copy uses capitalized "Panel" as component name |
| P3-6 | Chat | `font-size: 0` on icon buttons via fragile specificity chain |
| P3-7 | Chat | `.theme-dark` overrides duplicate what CSS variables should handle |
| P3-8 | Chat | Compact mode has no thinking-status adaptation |
| P3-9 | Statistics | "Markdown Files" label exposes format name; "Notes" is simpler |
| P3-10 | Statistics | UTC timestamp may confuse users; use local time |
| P3-11 | Settings | Plugin control modal uses hardcoded green/red (not theme vars) |
| P3-12 | Settings | Batch modal has no progress indicator during operations |

---

## 6. Cross-Surface Consistency Issues

### 6.1 Visual Language

| Property | Chat | Statistics | Settings | Pagelet | Verdict |
| --- | --- | --- | --- | --- | --- |
| Color system | Obsidian vars | **Tailwind hardcoded** | Obsidian native | Obsidian vars | **Stats is outlier** |
| Border radius | 8/12/14px | 4px | Obsidian native | 6/8/14px | **No shared scale** |
| Font sizing | Relative `em` | Tailwind classes | Obsidian native | Absolute `px` | **3 strategies** |
| Shadow | `0 18px 38px` | Tailwind `shadow-sm` | Obsidian native | `0 16px 42px` | Chat≈Pagelet, Stats different |
| Dark mode | Works | **Broken** | Works | Works | **Stats broken** |

### 6.2 One-Product Feel: 6/10

Chat and Pagelet share enough visual DNA to feel related. Settings uses
Obsidian native appearance, which integrates naturally. **Statistics is the
outlier** — it looks like an embedded third-party dashboard. Quick Capture
and confirmation modals blend in via Obsidian's native Modal class.

### 6.3 Terminology Consistency

| Term | Usage | Issue |
| --- | --- | --- |
| "Pagelet" | EN aria-labels, command names | Internal codename, not a user term |
| "vault" | Chat formatters | Obsidian-specific jargon |
| "memory" | Chat formatters, settings | Technical concept leaked as UI noun |
| "budget" | Chat formatters | Internal resource concept |
| "拾页" | ZH locale | Correct brand name |

---

## 7. Anti-Pattern Assessment

| AP | Name | Pet | Bubble | Panel | Tab | Chat | Stats | Settings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AP1 | ChatGPT feel | ✓ | ✓ | ✓ | ✓ | ⚠ | ✓ | ✓ |
| AP2 | Knowledge manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AP3 | AI drowning | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AP4 | Smart interruption | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AP5 | Premature automation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AP6 | Clickworker safety | ✓ | ✓ | ✓ | **✗** | ✓ | ✓ | ✓ |
| AP7 | Queue/badge creep | ✓ | ✓ | ⚠ | **✗** | ✓ | ✓ | ✓ |
| AP8 | Jargon leakage | ⚠ | ⚠ | ✓ | ✓ | **✗** | ✓ | ✓ |
| AP9 | Obligation language | ✓ | ✓ | ✓ | **✗** | ✓ | ✓ | ✓ |
| AP10 | Incomplete empty | — | ✓ | ✓ | ⚠ | ✓ | ✓ | ⚠ |

Legend: ✓ = pass, ⚠ = minor issue, ✗ = fail, — = not applicable

---

## 8. Improvement Roadmap

### Immediate (P0 — before v2.8 release)

| # | Action | Surfaces | Effort |
| --- | --- | --- | --- |
| 1 | Add CSS for 33 missing Tab classes | Tab | Medium |
| 2 | Reword Tab obligation language to optionality | Tab | Small |
| 3 | Fix Statistics dark mode (Obsidian CSS vars) | Statistics | Large |
| 4 | Remove jargon from Chat formatters | Chat | Medium |

### Short-term (P1 — current version cycle)

| # | Action | Surfaces | Effort |
| --- | --- | --- | --- |
| 5 | Add Quick Capture visual discoverability | Pet | Small |
| 6 | Add Tab section collapsing + navigation | Tab | Medium |
| 7 | Fix Tab scroll position on re-render | Tab | Medium |
| 8 | Keep Memory batch confirmation user-triggered and limited to visible candidates | Tab | Small |
| 9 | Reduce Chat thinking loader to single color | Chat | Small |
| 10 | Add Settings section collapsing | Settings | Medium |

### Mid-term (P2 — next 1-2 versions)

| # | Action | Surfaces | Effort |
| --- | --- | --- | --- |
| 11 | Define and enforce border-radius scale | All | Medium |
| 12 | Migrate Statistics to Obsidian color system | Statistics | Large |
| 13 | Reduce Bubble Quiet Recall buttons 4→2-3 | Bubble | Small |
| 14 | Add capture affordance to Bubble | Bubble | Small |
| 15 | Migrate `llm-*` CSS to `pa-chat-*` | Chat | Medium |
| 16 | Resolve "Pagelet" vs "拾页" EN naming | Pet, Bubble | Small |
| 17 | Surface critical Chat warnings on message | Chat | Small |

### Long-term (P3 — continuous polish)

Backlog items P3-1 through P3-12 as described in Section 5 above.

---

## 9. Comparison with v2.8.1 Feedback Fix Plan

Cross-referencing with `docs/v2.8.1-feedback-fix-plan.md`:

| Feedback Issue | Audit Finding | Status |
| --- | --- | --- |
| Settings API token appears lost | Not directly found in this audit (backend state issue) | Separate track |
| Memory "local storage locked" | Not found in UI audit (backend state) | Separate track |
| Unclear when Pagelet enters resting state | **Confirmed**: Mobile resting state is full opacity (P2-1) | Overlaps |
| Background preparation not observable | Not found as UI issue; observability is a feature gap | Separate track |
| Zero-findings nudge opens empty panel | **Confirmed**: Empty state handling is inconsistent (Tab AP10 ⚠) | Overlaps |

---

## 10. Summary

### What PA Does Well

- **Trustworthiness (B2 avg 4.2)** is the standout strength. Source evidence,
  preview/diff, undo paths, and cost transparency are consistently
  well-implemented across Panel and Chat.
- **Pagelet L1-L3 (Pet→Bubble→Panel)** demonstrate mature progressive
  disclosure. Each layer is self-contained; users can stop at any depth.
- **Quietness discipline** in Pet and Bubble is excellent — proactive hints
  are gated by flags, quiet hours, and cooldowns.
- **Mobile adaptations** are thorough: safe-area insets, 44px touch targets,
  bottom-sheet patterns, responsive layouts.
- **Accessibility fundamentals** are solid: ARIA roles, focus management,
  keyboard navigation, `prefers-reduced-motion` support.

### Where PA Needs Work

- **Tab (2.9/5)** is the single weakest surface and needs structural
  improvement (collapsible sections, scroll preservation, obligation language
  removal, missing CSS).
- **Statistics (3.1/5)** is visually broken in dark mode and architecturally
  disconnected from the rest of the plugin's design system.
- **Cross-surface consistency (6/10)** needs a unified design token system
  (border-radius, font-size, color references).
- **Jargon leakage** in Chat formatters directly violates a North Star
  constraint.
- **Quick Capture discoverability** is the highest-impact capture-friction
  gap given the "capture lightly" North Star.
