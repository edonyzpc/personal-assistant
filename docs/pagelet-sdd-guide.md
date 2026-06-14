# Pagelet — Software Design & Development Guide

> Target audience: AI coding agent (Codex / Claude Code)
> Purpose: Provide all product, UX, and architectural constraints needed to implement Pagelet as an Obsidian plugin feature inside PA.
> Source of truth: `pagelet-product-design.md` + `pagelet-prototype.html`

---

## 1. System Context

Pagelet is a **note-review feature** inside an existing Obsidian plugin called **Personal Assistant (PA)**. It shares PA's unified Agent Runtime via `RunKindAdapter` and uses the `Write Action Framework` for all file-creation operations.

```
┌─────────────────────────────────────────────────────────┐
│  Obsidian Plugin: Personal Assistant (PA)               │
│                                                         │
│  ┌───────────────────────┐   ┌────────────────────────┐ │
│  │  Pagelet           │   │  Other PA Features     │ │
│  │  - Pet (UI layer)     │   │  - Agent / Memory      │ │
│  │  - Bubble / Panel / Tab│  │  - Chat                │ │
│  │  - Background Preparation Engine     │   │  - Skills              │ │
│  └──────────┬────────────┘   └────────────────────────┘ │
│             │                                           │
│  ┌──────────▼────────────────────────────────────────┐  │
│  │  Shared Infrastructure                            │  │
│  │  - RunKindAdapter (runKind: foreground|background)│  │
│  │  - Write Action Framework (D025, D030)        │  │
│  │  - LLM Provider abstraction                      │  │
│  │  - i18n / Settings / future metrics policy       │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Decisions

| ID | Rule |
| --- | --- |
| D032 | Background preparation engine introduction — timed polling + change detection + AI + cache |
| D033 | Pet states: 4 states (resting, idle, working, nudge) |
| D034 | Pet fixed corner position (configurable, no drag) |
| D035 | Periodic summary simplified flow (one-click generate) |
| D036 | Separate background preparation/foreground cost control pools |
| D037 | Progressive disclosure: Pet → Bubble → Panel → Tab |
| D038 | Proactive hints: opt-in, OFF by default |
| D039 | Proactive hints control placement: Settings + Panel header + Command Palette + hotkey |

---

## 2. Delivery Order

Implementation milestones (alpha releases):

| Phase | Scope |
| --- | --- |
| **beta milestone 1** | Pet (4 states, corner position), Bubble, Background preparation engine, Scenario 1 (Quick Review), Scenario 4 (Periodic Summary) |
| **beta milestone 2** | Scenario 2 (Writing Assistance), Proactive hints (D038) |
| **beta milestone 3** | Scenario 3 (Knowledge Discovery), Panel redesign |

---

## 3. Component Architecture

### 3.1 Pet

**What it is**: A 48×56px floating SVG element fixed to a corner of the active markdown leaf.

**Mounting rules (D029/R1)**:
- ONLY mount on views where `view.getViewType() === 'markdown'`.
- NEVER mount on Excalidraw canvases, Kanban boards, Canvas leaves, or custom views.

**Position**:
- Fixed to one of 4 corners: `bottom-right` (default), `bottom-left`, `top-right`, `top-left`.
- Persisted per vault in `settings.pagelet.petCorner`.
- Avoids overlapping scrollbars, the status bar, and Obsidian workspace chrome.
- NOT draggable. No pin, no double-click reposition.

**DOM structure** (from prototype):
```html
<div class="pet-container" data-state="idle" tabindex="0" role="button" aria-label="拾页助手">
  <div class="pet-wrapper">
    <div class="pet-notification"></div>  <!-- green dot for nudge -->
    <div class="pet-svg-wrap">
      <svg width="52" height="52" viewBox="0 0 44 44">
        <!-- Paper body: folded sheet -->
        <path class="pet-body" d="M10.2 8.3 L30 8 L36.1 14.2 L36 37.8 L10 38.1 Z" ... />
        <!-- Dog-ear fold -->
        <path class="pet-fold" d="M30 8.1 L29.9 14.2 L36 14" ... />
        <!-- Eyes (normal: arc curves, resting: horizontal lines) -->
        <!-- Working dots (3 pulsing circles) -->
        <!-- Nudge mouth (smile curve) -->
        <!-- Resting zzz text -->
      </svg>
    </div>
  </div>
</div>
```

**Visual spec**:
- Shape: folded paper sheet (折角纸张), minimal hand-drawn lines.
- Stroke: 1.6px with slight jitter (手绘感), rounded line caps and joins.
- Eyes: arc curves (`Q` bezier), stroke-width 1.4px.
- Base color: neutral gray `#e8e8e8`.
- Style anchor: Tldraw-like 手绘人文 (D005).

**Interaction**:
- Single gesture only: **click** (desktop) / **tap** (mobile).
- No right-click menu. No long-press context menu.
- Click → toggle Bubble.
- Keyboard: `Enter` or `Space` when focused → toggle Bubble.

### 3.2 Pet State Machine

4 states, system-driven (user cannot manually set state):

| State | Color | SVG features | Animation | Trigger |
| --- | --- | --- | --- | --- |
| `resting` | `#d0d0d0` gray, opacity 0.55 | Closed eyes (horizontal lines), zzz text | `pet-breathe` 5s, zzz float | No note activity for extended period |
| `idle` | `#e8e8e8` neutral gray, opacity 1 | Normal arc eyes with blink | `pet-float` 2.8s, blink every 5s | Standby, awake |
| `working` | `#7c9eff` blue, opacity 1 | 3 pulsing dots in mouth area | `pet-pulse` 1.4s, dots pulse staggered | AI background preparation OR user-triggered analysis in progress |
| `nudge` | `#5dd39e` green, opacity 1 | Smile mouth, notification dot | `pet-bounce` 1.6s, dot glow 1.8s | Insights ready + proactive hints ON |

**State transitions**:
```
                        ┌──────────┐
    long idle           │ resting  │
    ◄───────────────────┤          │
                        └────┬─────┘
                             │ note activity detected
                             ▼
                        ┌──────────┐
                    ┌───┤   idle   │◄──────────────────┐
                    │   └────┬─────┘                   │
                    │        │ background preparation/analysis starts  │ analysis done / user finishes
                    │        ▼                          │
                    │   ┌──────────┐                   │
                    │   │ working  ├───────────────────►┘
                    │   └────┬─────┘
                    │        │ insights ready + 主动提示 ON
                    │        ▼
                    │   ┌──────────┐
                    │   │  nudge   │──── user clicks ──► idle
                    │   └──────────┘
                    │
                    └──── background preparation/analysis starts ──► working
```

**Error handling**: Errors shown as 1.5s flash on Pet, then return to `idle` with small error badge. Error details appear in Bubble on click.

**`prefers-reduced-motion`**: Keep color changes, remove all float/jitter/animation.

### 3.3 Bubble

**What it is**: A lightweight speech bubble that appears near the Pet. First response surface for all scenarios.

**Dimensions**: ~280-300px wide, dynamic height up to ~320px.

**Appearance**:
- Speech bubble shape with triangular tail pointing to Pet.
- Background: theme-aware (`var(--bubble-bg)`).
- Border: 1px, hand-drawn style consistent with Pet.
- Border-radius: 12px.
- Shadow: `0 8px 32px var(--shadow), 0 2px 8px var(--shadow)`.

**Content structure**:
```
┌────────────────────────────────────┐
│                              [×]   │  ← close button
│                                    │
│  • Finding 1 (with source link)    │  ← max 3 items
│  • Finding 2 (with source link)    │
│  • Finding 3 (with source link)    │
│                                    │
│  [展开]  [看当前笔记]  [发现关联]    │  ← quick actions
│                                    │
└────────────────────────────────────┘
         ▽  ← tail pointing to Pet
```

**Dismiss behavior** (critical UX contract):
| Action | Result |
| --- | --- |
| Click outside Bubble | Bubble **degrades** (semi-transparent, `opacity: 0.4`, pointer-events none) — NOT closed |
| Click Pet again (when degraded) | Bubble **restores** to visible |
| Press Escape | Bubble **fully closes** |
| Click × button | Bubble **fully closes** |

**CSS states**:
```css
.bubble.visible    { opacity: 1; pointer-events: auto; }
.bubble.degraded   { opacity: 0.4; pointer-events: none; }
/* hidden: no class, default state */
```

**Animation**:
- Show: scale(0.9) → scale(1), translateY(8px) → 0, opacity 0 → 1 (0.25s ease).
- Degrade: opacity transition to 0.4.

**Constraints**:
- Bubble does NOT steal focus from editor.
- No editing, no draft collection, no note creation from the Bubble.
- Max 3 items. If more exist, "展开" opens Panel.

### 3.4 Panel

**What it is**: A side panel (~360-380px wide) for deeper exploration.

**Entry**: "展开" from Bubble, or Command Palette.

**Design direction (Pagelet direction, detailed design TBD)**:
- Scenario-adaptive layout (changes based on which scenario opened it).
- NOT the historical design fixed four-category card list.
- Dynamic, AI-organized layout.
- Source transparency preserved (every finding links to source).
- Timeline-based layout for review (from prototype).

**Panel structure** (from prototype):
```
┌─────────────────────────────────────┐
│  [Title]           [↗ expand] [×]   │  ← header
├─────────────────────────────────────┤
│                                     │
│  [Timeline / Discovery / Analysis]  │  ← body (scrollable)
│                                     │
├─────────────────────────────────────┤
│  [展开为标签页 →]                     │  ← footer
└─────────────────────────────────────┘
```

**Panel header actions**: expand to tab (↗), close (×).

**Session-persistent**: Panel stays open until explicitly closed. Survives leaf navigation.

### 3.5 Tab

**What it is**: Full editor tab for complex exploration.

**Entry**: "展开为标签页" from Panel.

**Layout**: Full-width content area (max-width 800px) with sections.

**Mobile**: Tab concept does not apply on mobile (Panel already takes full screen).

---

## 4. Interaction Flows (Four Scenarios)

### Scenario 1: Quick Review (快速回顾)

```
User clicks Pet → Bubble shows 2-3 cached findings → User reads → Dismiss
```

- AI source: cached background preparation result.
- If no cache: show "还没有新发现" + option to trigger immediate analysis.
- Key property: "看完就走" — zero output, under 10 seconds.
- No artifacts produced.

### Scenario 2: Writing Assistance (写作辅助)

**User-initiated path**:
```
User editing note → clicks Pet → Bubble shows context-relevant suggestions
  (e.g., "this paragraph could cite [[note-from-3-days-ago]]")
→ User clicks source link or dismisses
```

**Proactive-hint path** (requires 主动提示 ON):
```
User editing → Background preparation detects signal → Pet → nudge state
→ User clicks Pet → Bubble shows suggestion → dismiss or "展开"
```

### Scenario 3: Knowledge Discovery (知识发现)

```
User clicks Pet or Command Palette → Bubble shows preview
  ("Found 5 related notes and 2 potential themes")
→ User clicks "展开" or "发现关联"
→ Panel opens with: related notes + cross-note themes + research gaps
→ Optional: save findings as review note
```

Panel shows a connection map (from prototype: nodes + dashed lines connecting related notes).

### Scenario 4: Periodic Summary (周期性整理)

```
Command Palette "Pagelet: Generate periodic summary" or Panel header trigger
→ AI analyzes last 7 days (configurable) → generation overlay
→ Preview of review note → User confirms → note created in .pagelet/
```

- One-click trigger to output. No draft-collection step.
- Write boundary: preview + explicit confirmation before write.
- Generation overlay: spinner + "正在生成周报..." text.

---

## 5. Background Preparation Engine

### Architecture

```
Timer (configurable interval, default 30min)
  │
  ▼
Change Detection (file mtime vs last-analyzed timestamps)
  │ changed notes found?
  ▼
Budget Check (per-hour cap remaining?)
  │ yes
  ▼
AI Analysis (runKind="background", allowWrite=false, 4K+1K token budget)
  │
  ▼
Cache Result (in-memory, per vault)
  │
  ▼
Pet State Update (if 主动提示 ON → nudge; else remain idle)
```

### Constraints

| Rule | Detail |
| --- | --- |
| No local preprocessing | NO regex-based TODO detection, NO rule-based scanning. AI does ALL intelligence. |
| Security | `runKind="background"` with hardcoded `allowWrite=false`. Background path can NEVER trigger writes. |
| Token budget | 4K input + 1K output default; configurable up to 8K input + 2K output. |
| Hard ceiling | 8K input + 2K output per background preparation call. |
| Per-hour cap | 2 background preparation calls (default). |
| Per-day cap | 20 background preparation calls (default). |
| On ceiling hit | Silently skip cycle (no user notification). |
| Scope | Recent notes in the 7-day scope that changed since the last cycle. Same exclusion rules as foreground. |
| Cache lifetime | In-memory only. Cleared on: new background preparation run, vault close, explicit user clear. |
| NOT persisted to disk | Privacy consideration. |

### Foreground vs Background preparation — Independent Pools

| Dimension | Background preparation (background) | Foreground (user-triggered) |
| --- | --- | --- |
| Token budget | 4K + 1K | 8K + 2K (default) |
| Per-hour cap | 2 | 10 |
| Per-day cap | 20 | 100 |
| On ceiling | Silent skip | Show a foreground limit notice; user can adjust settings and retry |

Pools are **independent**. Foreground calls are NOT constrained by background preparation quota.

---

## 6. Proactive Hints (主动提示)

- **OFF by default**. Opt-in feature.
- When ON: Pet enters `nudge` state when prepared insights are ready.
- User clicks Pet → normal Bubble flow.

**Behavior constraints**:
- Never opens a modal or dialog.
- Never plays a sound.
- Never moves focus away from editor.
- Visual change is subtle (green notification dot + gentle bounce).
- After user views Bubble, hint clears. Does not re-signal for same insight set.
- Cooldown: at most once per configurable interval (default 30 minutes).

**Control surfaces** (D039):
1. Settings → Pagelet → full configuration (enable/disable, cooldown, quiet hours).
2. Panel header → quick toggle: "主动提示 开/关".
3. Command Palette → `Pagelet: Toggle proactive hints`.
4. Keyboard shortcut (registered, no default binding).

---

## 7. Note Selection & Scope

### Foreground Scope

Default: **current note** for click/hotkey interactions.

Expandable via Panel:
- Current note (default).
- Yesterday.
- Last 3 days.
- Last 7 days.

Custom range/date-picker scope is future work.

### Background preparation Scope

- Recent notes in the 7-day scope that changed since last background preparation cycle.
- Subject to exclusion rules.

### Periodic Summary Scope

- Default: last 7 days (configurable: 3d / 7d / 14d).
- No manual include/exclude. AI decides based on time range.
- Preview shows which notes were included.

### Exclusion Rules

Default exclusions:
- `.trash`
- Hidden/system folders (including `.pagelet/` itself)
- Templates folder
- Plugin-generated directories
- Empty files
- Non-Markdown files
- Files marked `pagelet: true` in frontmatter (D029)
- Extremely large files beyond review budget

Configurable exclusions:
- Excluded folders
- Excluded tags: `#private`, `#no-ai`, `#no-review`
- Excluded filename/path patterns

---

## 8. Review Note Output

### When output is produced

| Scenario | Produces note? |
| --- | --- |
| Quick Review | No |
| Writing Assistance | No |
| Knowledge Discovery | Optional (user explicitly requests) |
| Periodic Summary | Yes (one-click generate → preview → confirm) |

### File naming

Single-note review:
```
{原笔记名}-pagelet-review-{YYYY-MM-DD}.md
```

Periodic summary:
```
pagelet-weekly-review-{YYYY-MM-DD}.md
```

### Target folder

Default: `.pagelet/` (D008). Configurable. On collision: auto-suffix to `.pagelet-reviews/`.

### Frontmatter

```yaml
---
pagelet: true
range: "YYYY-MM-DD to YYYY-MM-DD"
generated_at: "YYYY-MM-DDTHH:mm:ssZ"
sources: ["[[note-1]]", "[[note-2]]"]
pagelet_cost_usd: 0.003
---
```

### Note structure

```markdown
---
pagelet: true
range: "..."
generated_at: "..."
sources: [...]
---

# Review of "{源笔记名}" -- YYYY-MM-DD

## Summary
...

## Insights
- ...
  Sources: [[...]]

## Possible next actions
- ...
  Sources: [[...]]

## Research gaps
- ...
  Sources: [[...]]

## Related notes
- [[...]] - ...

## Sources
- [[...]]
```

### Write Boundary (D025, D030)

All writes go through **Write Action Framework**: preview → confirmation → target confinement → stale re-read → audit.

**Allowed**: Create one independent review note in `.pagelet/` after preview and explicit confirmation.

**NOT allowed**:
- Modify source notes.
- Append to daily notes.
- Update frontmatter on source notes.
- Create or update tasks.
- Move or rename files.
- Apply suggestions back into old notes.
- Automatically write WebSearch results.

**Conflict handling**: If note already exists → offer cancel, rename, or append suffix. NEVER overwrite without explicit user choice.

---

## 9. Visual Specifications (from prototype CSS)

### Color Tokens

```css
:root {
  /* Pet state colors */
  --pagelet-neutral: #e8e8e8;
  --pagelet-thinking: #7c9eff;
  --pagelet-done: #5dd39e;
  --pagelet-error: #ff6b6b;

  /* Dark theme (default) */
  --bg: #1e1e1e;
  --bg-2: #252525;
  --bg-3: #2d2d2d;
  --fg: #e8e8e8;
  --fg-2: #a0a0a0;
  --fg-3: #707070;
  --border: #3a3a3a;
  --bubble-bg: #2a2a2a;
  --panel-bg: #222222;
  --shadow: rgba(0,0,0,0.4);
}

[data-theme="light"] {
  --bg: #f5f5f5;
  --bg-2: #ebebeb;
  --bg-3: #e0e0e0;
  --fg: #2c2c2c;
  --fg-2: #666666;
  --fg-3: #999999;
  --border: #d0d0d0;
  --bubble-bg: #ffffff;
  --panel-bg: #fafafa;
  --shadow: rgba(0,0,0,0.12);
}
```

### Light Theme Pet Enhancements

In light theme, Pet uses darker strokes for visibility:
```
resting: #a0a0a0
idle: #666666
working: #5a7de6
nudge: #3dba82
```

Light theme Pet wrapper: white background with subtle shadow:
```css
background: rgba(255,255,255,0.75);
border-radius: 10px;
box-shadow: 0 2px 12px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06);
```

State-specific light-theme glow:
- `working`: `box-shadow: 0 2px 16px rgba(124,158,255,0.3), 0 0 0 1.5px rgba(124,158,255,0.4)`
- `nudge`: `box-shadow: 0 2px 20px rgba(93,211,158,0.35), 0 0 0 2px rgba(93,211,158,0.2)`
- `resting`: opacity 0.4, desaturated, dimmer

### Animation Keyframes

| Animation | Duration | Easing | Used by |
| --- | --- | --- | --- |
| `pet-float` | 2.8s | ease-in-out | idle state |
| `pet-breathe` | 5s | ease-in-out | resting state |
| `pet-pulse` | 1.4s | ease-in-out | working state |
| `pet-bounce` | 1.6s | ease-in-out | nudge state |
| `pet-blink` | 5s | — | idle eyes |
| `dot-pulse` | 1.4s, staggered 0.2s | — | working dots |
| `nudge-dot-glow` | 1.8s | ease-in-out | notification dot |
| `zzz-float-1` | 3s | ease-out | resting zzz |
| `zzz-float-2` | 3s, delay 0.8s | ease-out | resting zzz (second z) |

### Transitions

- Bubble show/hide: 0.25s ease (opacity + transform).
- Panel slide: 0.35s cubic-bezier(0.4, 0, 0.2, 1).
- Tab view: 0.3s ease (opacity).
- Pet state: color transitions via stroke attribute update + CSS animation change.

---

## 10. Mobile Adaptation

### Pet on Mobile

- Fixed to configurable corner (same model as desktop).
- Scale: 80% (`transform: scale(0.8)`).
- Minimum touch target: 44×44px (iOS HIG / WCAG 2.5.5).
- Tap = show Bubble. Single gesture only.
- No hover. No long-press context menu.

### Bubble on Mobile

- **Full-width bottom sheet** (NOT positioned relative to Pet).
- Slides up from bottom edge (`animation: bubble-slide-up 0.25s ease-out`).
- Tail hidden.
- Larger text and touch targets (`padding: 10px 12px`, `font-size: 14px`).
- Swipe down to dismiss.
- CSS:
```css
body.mobile-mode .bubble {
  left: 8px; right: 8px; bottom: 80px;
  width: auto; max-width: none;
  border-radius: 16px 16px 12px 12px;
}
```

### Panel on Mobile

- **Full-screen overlay** (slides up from bottom, `transform: translateY(100%)` → `translateY(0)`).
- Width 100%, height 100%.
- No "展开为标签页" option on mobile (Panel IS the full view).
- No panel footer.

### Tab on Mobile

- Tab does not apply. Panel already takes full screen.
- Review notes open as regular Obsidian note tabs.

### Mobile breakpoint

Natural breakpoint: `@media (max-width: 768px)` OR manual `.mobile-mode` class toggle.

---

## 11. Command Palette Commands

All commands registered with `Pagelet:` prefix (D029).

**New Pagelet commands**:
| Command | Action |
| --- | --- |
| `Pagelet: Quick review` | Open existing prepared findings in the Bubble without triggering a provider call; falls back to Panel when the Pet/Bubble anchor is unavailable |
| `Pagelet: Discover connections` | Current beta: run current-note analysis and open the discovery Panel layout; dedicated cross-note discovery is future work |
| `Pagelet: Generate periodic summary` | Trigger Scenario 4 |
| `Pagelet: Toggle proactive hints` | Toggle 主动提示 on/off |
| `Pagelet: Show background preparation status` | Show background preparation engine diagnostics |
| `Pagelet: Move Pet to corner` | Switch Pet corner position |
| `Pagelet: Toggle Pet visibility` | Show/hide Pet |

**Preserved historical design commands**:
| Command | Action |
| --- | --- |
| `Pagelet: Review current note` | Run current note analysis and open Bubble or Panel with results |
| `Pagelet: Open Pagelet` | Open Panel without triggering analysis; the empty panel offers `Review current note` as the explicit provider-backed action |

---

## 12. Settings Schema

```typescript
interface PageletSettings {
  // General
  enabled: boolean;                    // default: true
  petVisible: boolean;                 // default: true

  // Pet
  petCorner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'; // default: 'bottom-right'
  proactiveHints: boolean;             // default: false (OFF)
  proactiveHintsCooldown: 15 | 30 | 60 | 120; // minutes, default: 30
  proactiveHintsQuietHours: {
    enabled: boolean;                  // default: false
    start: string;                     // HH:mm
    end: string;                       // HH:mm
  };

  // Background preparation (stored under preload* keys for migration compatibility)
  preloadEnabled: boolean;             // default: false
  preloadInterval: 5 | 15 | 30 | 60 | 120 | 240; // minutes, default: 30
  preloadPerHourCap: number;           // default: 2
  preloadPerDayCap: number;            // default: 20

  // Storage
  reviewsFolder: string;               // default: '.pagelet'

  // Reviews
  periodicSummaryScope: '3d' | '7d' | '14d'; // default: '7d'
  excludedFolders: string[];
  excludedTags: string[];
  excludedPatterns: string[];

  // Language
  outputLanguage: 'auto' | 'en' | 'zh'; // default: 'auto'

  // Cost — Foreground
  maxInputTokens: number;               // default: 8000
  maxOutputTokens: number;              // default: 2000
  foregroundPerHourCap: number;        // default: 10
  foregroundPerDayCap: number;         // default: 100

  // Cost — Background preparation (stored under preload* keys for migration compatibility)
  preloadTokenBudget: { input: number; output: number }; // default: {4000, 1000}; max {8000, 2000}
}
```

---

## 13. Accessibility (D007)

- Pet has `tabindex="0"`, `role="button"`, `aria-label="拾页助手"`.
- Keyboard: Enter/Space on Pet → toggle Bubble.
- Escape → close overlays (Tab > Panel > Bubble priority).
- All interactive elements must be keyboard-reachable.
- `prefers-reduced-motion`: disable all animations, keep color state changes.
- Notification dot for nudge: ensure color is not the only indicator (also has gentle bounce for motion-ok users; for reduced-motion, the dot's presence alone is sufficient since it's a bonus feature).

---

## 14. Plugin Compatibility (D029)

| Plugin | Coexistence rule |
| --- | --- |
| Copilot for Obsidian | `.pagelet/` vs `.copilot/` are distinct |
| Smart Connections | Pet uses neutral gray (not purple) |
| Templater | Review files have `pagelet: true` frontmatter so Templater can skip |
| Linter | Pagelet writes via `vault.adapter.write` (bypass `modify`); recommend Linter exclude `.pagelet/` |
| Dataview | `file-open` listener uses 300ms debounce |
| Excalidraw / Kanban / Canvas | Pet only mounts on markdown views |
| Calendar / Periodic Notes | `.pagelet/` is dotfolder, PN ignores by default |
| Tasks | Action suggestions use Tasks-compatible emoji syntax (`- [ ] 📅`) |

---

## 15. Privacy & Security Invariants

1. Background review preparation reads only recent changed notes from the current 7-day scope, subject to exclusion rules.
2. Background preparation results cached in memory only — NEVER persisted to disk.
3. Background preparation can be fully disabled in settings.
4. Background path uses `runKind="background"` with `allowWrite=false` — can NEVER trigger writes.
5. Pet shows `working` state during background preparation (transparency).
6. No sending skipped note bodies to model.
7. Clear included/skipped details visible in Panel.
8. Source-backed suggestions only.
9. Preview before write.
10. User-confirmed note creation.
11. The plugin does not collect telemetry or analytics today; any future metrics must be content-free.

---

## 16. Future Metrics Candidates

The plugin does not currently collect telemetry or analytics. If Pagelet adds local or opt-in metrics later, the only allowed candidates are content-free:
- `pagelet.background_preparation.cycle` — count
- `pagelet.background_preparation.findings` — count
- `pagelet.hint.shown` — count
- `pagelet.hint.clicked` — count
- `pagelet.hint.dismissed` — count
- `pagelet.bubble.open` — count
- `pagelet.bubble.escalate` — count (bubble → panel)
- `pagelet.review.triggered` — with scope type
- `pagelet.note.created` — count
- `pagelet.pet.corner` — which corner (not coordinates)
- `pagelet.cost.*` — token/USD metrics

Always disallowed:
- Prompt text, note text, note titles/paths, suggestion body, user follow-up text, WebSearch query text, created review note content.

---

## 17. Copy & Tone

Voice: warm, specific, careful, research-assistant-like. No exaggeration.

**Prefer**:
- "These notes all mention X, so it may be worth collecting into a theme."
- "This looks like a research gap: you mention Y but do not cite a source."
- "Evidence is thin, so this is marked as a possible thread."
- "正在准备..." (working state)

**Avoid**:
- "主人，我发现啦！"
- "You must do this."
- "This is a major breakthrough."
- "I already handled it for you."

**Pet state copy**:
- `resting`: (no text)
- `idle`: (no text)
- `working`: "正在准备..." / "Preparing..."
- `nudge`: (no text; visual cue only)

---

## 18. Success Criteria (Acceptance Tests)

### Pet & Bubble
- [ ] Pet correctly renders all 4 states with correct colors, animations, and SVG features.
- [ ] Pet is fixed to configurable corner; persists corner choice across sessions.
- [ ] Bubble opens in <200ms when cached results exist.
- [ ] Click-outside degrades Bubble (semi-transparent). Click Pet restores it.
- [ ] Escape / × fully closes Bubble.
- [ ] Bubble shows max 3 relevant findings from prepared analysis.

### Background Preparation Engine
- [ ] Background preparation runs at configured interval.
- [ ] Background preparation respects all exclusion rules.
- [ ] Background preparation stays within cost limits (2/hour, 20/day default).
- [ ] Background preparation uses `runKind="background"` with `allowWrite=false`.
- [ ] Background preparation can be fully disabled via settings.
- [ ] Pet shows `working` state during background preparation.

### Proactive Hints
- [ ] Toggle works from Settings, Panel header, Command Palette.
- [ ] Cooldown respected (default 30 min between hints).
- [ ] No sound, no modal, no focus steal.
- [ ] Hint clears after user views Bubble.

### Periodic Summary
- [ ] One-click trigger generates complete review note.
- [ ] Preview shown before write confirmation.
- [ ] Created note is valid Markdown with correct frontmatter in `.pagelet/`.

### Core Invariants
- [ ] Creating a note never modifies source notes.
- [ ] WebSearch only runs from explicit user action.
- [ ] Cost ceiling enforced; foreground limit hits show a notice and can be adjusted in settings.
- [ ] No telemetry or analytics are collected today; any future metrics remain content-free.
- [ ] Pet only mounts on `markdown` view type.
- [ ] Pending drafts survive Panel close/reopen.

---

## 19. File Structure (Expected)

```
src/
├── pagelet/
│   ├── pet/
│   │   ├── PetView.ts          # Pet DOM element lifecycle, mounting rules
│   │   ├── PetStateMachine.ts  # 4-state machine, transitions
│   │   ├── PetSvg.ts           # SVG rendering, state-driven appearance
│   │   └── PetAnimations.css   # Keyframes, state-driven animations
│   ├── bubble/
│   │   ├── BubbleView.ts       # Bubble DOM, positioning, degrade/restore
│   │   └── BubbleContent.ts    # Content rendering for 4 scenarios
│   ├── panel/
│   │   ├── PanelView.ts        # Side panel lifecycle
│   │   └── PanelLayouts.ts     # Scenario-adaptive layouts (timeline, discovery, etc.)
│   ├── tab/
│   │   └── TabView.ts          # Full tab workspace
│   ├── preload/              # Internal compatibility name; user-facing copy says background preparation.
│   │   ├── PreloadEngine.ts  # Timer + change detection + AI dispatch
│   │   ├── PreloadCache.ts   # In-memory cache per vault
│   │   └── PreloadBudget.ts  # Rate limiting (per-hour, per-day)
│   ├── output/
│   │   ├── ReviewNoteGenerator.ts  # AI → complete note generation
│   ├── scope/
│   │   ├── ScopeResolver.ts    # Auto-scope + exclusion rules
│   │   └── ChangeDetector.ts   # mtime comparison for background preparation
│   ├── hints/
│   │   └── ProactiveHints.ts   # Hint scheduling, cooldown, quiet hours
│   ├── commands.ts             # Command palette registrations
│   ├── settings.ts             # Settings tab + defaults
│   └── index.ts                # Feature entry point, lifecycle hooks
```

---

## 20. Key Implementation Notes

1. **RunKindAdapter extension**: Must support `runKind="background"` with hardcoded `allowWrite=false`. This is distinct from the existing on-demand `runKind="foreground"`.

2. **No LLM-free fallback (D003)**: If the LLM provider is not configured, Pagelet is non-functional. Show appropriate empty state.

3. **Structured output (D026)**: AI responses use structured output schemas for type-safe parsing of findings, sources, and suggestions.

4. **i18n (D014)**: All UI strings go through PA's i18n system. Review generation language is a separate setting (`follow-source` / `en` / `zh`).

5. **Debounce**: `file-open` listener uses 300ms debounce (Dataview compat, D029).

6. **Write via adapter**: Use `vault.adapter.write` not `vault.modify` (Linter compat, D029).

7. **Theme awareness**: Use Obsidian's theme CSS variables where possible. Custom tokens only for Pet-specific colors.

8. **Generation overlay**: Full-screen semi-transparent overlay with spinner during periodic summary generation. Shows Pet SVG with pulsing dots as spinner icon.

---

## Appendix: Prototype Reference

The interactive prototype at `docs/pagelet-prototype.html` demonstrates:
- All 4 Pet states with live switching.
- Bubble open/degrade/restore/close lifecycle.
- Panel with timeline layout (review), current note analysis, and discovery map.
- Tab expansion with theme clustering and action suggestions.
- Mobile preview mode (full-width bottom sheet Bubble, full-screen Panel).
- Light/dark theme toggle.
- Scenario demos (Quick Review, Writing Assistance, Knowledge Discovery, Periodic Summary).

Use this prototype as the **visual fidelity reference** for implementation. CSS values, animations, and layout structures in the prototype are authoritative.
